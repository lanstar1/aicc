import type { FastifyInstance } from 'fastify';
import WebSocket, { type RawData } from 'ws';
import { z } from 'zod';

import { env } from '../../config/env';
import type { CallControlTarget } from '../control/registry';
import {
  analyzeTurn,
  type AnalyzeTurnInput,
  type ConversationState
} from '../orchestrator/service';
import { buildApprovedTurnInstructions, resolveTurnResponse } from '../orchestrator/turn-runtime';
import { finalizeCallSession } from '../calls/finalize-service';
import { buildGreetingMessage, buildRealtimeInstructions } from './prompt';

const twilioConnectedSchema = z.object({
  event: z.literal('connected'),
  protocol: z.string(),
  version: z.string()
});

const twilioStartSchema = z.object({
  event: z.literal('start'),
  sequenceNumber: z.string().optional(),
  start: z.object({
    streamSid: z.string(),
    callSid: z.string(),
    accountSid: z.string().optional(),
    tracks: z.array(z.string()).optional(),
    customParameters: z.record(z.string()).optional(),
    mediaFormat: z
      .object({
        encoding: z.string(),
        sampleRate: z.union([z.string(), z.number()]).optional(),
        channels: z.union([z.string(), z.number()]).optional()
      })
      .optional()
  }),
  streamSid: z.string().optional()
});

const twilioMediaSchema = z.object({
  event: z.literal('media'),
  sequenceNumber: z.string().optional(),
  streamSid: z.string(),
  media: z.object({
    track: z.enum(['inbound', 'outbound']),
    chunk: z.string().optional(),
    timestamp: z.string().optional(),
    payload: z.string()
  })
});

const twilioDtmfSchema = z.object({
  event: z.literal('dtmf'),
  streamSid: z.string(),
  dtmf: z.object({
    digit: z.string()
  })
});

const twilioMarkSchema = z.object({
  event: z.literal('mark'),
  streamSid: z.string(),
  mark: z.object({
    name: z.string()
  })
});

const twilioStopSchema = z.object({
  event: z.literal('stop'),
  sequenceNumber: z.string().optional(),
  streamSid: z.string(),
  stop: z.object({
    callSid: z.string(),
    accountSid: z.string().optional()
  })
});

const twilioMessageSchema = z.discriminatedUnion('event', [
  twilioConnectedSchema,
  twilioStartSchema,
  twilioMediaSchema,
  twilioDtmfSchema,
  twilioMarkSchema,
  twilioStopSchema
]);

export class OpenAiRealtimeBridge {
  private openAiSocket: WebSocket | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private callerNumber: string | null = null;
  private greetingSent = false;
  private sessionReady = false;
  private responseActive = false;
  private closed = false;
  private aiTranscriptBuffer = '';
  private aiSuspended = false;
  private greetingFallbackTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly twilioSocket: WebSocket,
    private readonly callSessionId: string
  ) {
    this.app.callControlRegistry.register(this.callSessionId, {
      kind: 'twilio_openai',
      injectAiInstruction: async (instruction: string) => {
        await this.injectAiInstruction(instruction);
      },
      takeover: async (target: CallControlTarget, reason?: string) => {
        await this.takeover(target, reason);
      },
      close: () => {
        this.close();
      }
    });
  }

  async handleTwilioMessage(raw: RawData) {
    const message = parseTwilioMessage(raw.toString());

    switch (message.event) {
      case 'connected':
        this.broadcast({
          type: 'twilio.connected',
          callSessionId: this.callSessionId,
          protocol: message.protocol,
          version: message.version
        });
        break;
      case 'start':
        await this.handleStart(message);
        break;
      case 'media':
        await this.handleMedia(message);
        break;
      case 'dtmf':
        await this.handleDtmf(message);
        break;
      case 'mark':
        this.broadcast({
          type: 'twilio.mark',
          callSessionId: this.callSessionId,
          streamSid: message.streamSid,
          name: message.mark.name
        });
        break;
      case 'stop':
        await this.handleStop(message);
        break;
    }
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.clearGreetingFallbackTimer();
    this.app.callControlRegistry.unregister(this.callSessionId);

    if (this.openAiSocket && this.openAiSocket.readyState === this.openAiSocket.OPEN) {
      this.openAiSocket.close();
    }
  }

  async injectAiInstruction(instruction: string) {
    if (!instruction.trim()) {
      return;
    }

    this.aiSuspended = false;
    this.sendTwilioControl('clear');
    this.sendOpenAiEvent({
      type: 'response.cancel'
    });
    this.sendOpenAiEvent({
      type: 'response.create',
      response: {
        output_modalities: ['audio'],
        instructions: instruction
      }
    });

    await this.appendCallEvent('human_note', 'manager', instruction, {
      action: 'ai_instruction'
    });

    this.broadcast({
      type: 'manager.command',
      callSessionId: this.callSessionId,
      action: 'ai_instruction',
      content: instruction
    });
  }

  async takeover(target: CallControlTarget, reason?: string) {
    this.aiSuspended = true;
    this.responseActive = false;
    this.sendTwilioControl('clear');
    this.sendOpenAiEvent({
      type: 'response.cancel'
    });

    await this.app.db.query(
      `
        update aicc.call_session
        set
          handoff_required = true,
          handoff_target = $2::aicc.handoff_target_t,
          handoff_reason = $3,
          status = 'handoff'
        where id = $1
      `,
      [this.callSessionId, target, reason ?? 'manager_takeover']
    );

    await this.appendCallEvent('handoff', 'manager', reason ?? 'manager_takeover', {
      action: 'takeover',
      target
    });

    this.broadcast({
      type: 'manager.command',
      callSessionId: this.callSessionId,
      action: 'takeover',
      target,
      content: reason ?? 'manager_takeover'
    });
  }

  private async handleStart(message: z.infer<typeof twilioStartSchema>) {
    this.streamSid = message.start.streamSid;
    this.callSid = message.start.callSid;
    this.callerNumber = message.start.customParameters?.callerNumber ?? null;

    this.app.log.info(
      {
        route: 'twilio.media.start',
        callSessionId: this.callSessionId,
        callSid: this.callSid,
        streamSid: this.streamSid,
        callerNumber: this.callerNumber
      },
      'Twilio media stream started'
    );

    this.app.realtimeHub.setProviderCallId(this.callSessionId, message.start.callSid);

    if (this.callerNumber) {
      this.app.realtimeHub.setCaller(this.callSessionId, this.callerNumber);
    }

    await this.app.db.query(
      `
        update aicc.call_session
        set
          provider_call_id = coalesce(provider_call_id, $2),
          caller_number = coalesce($3, caller_number),
          caller_number_digits = coalesce(regexp_replace($3, '\D', '', 'g'), caller_number_digits),
          status = 'live',
          answered_at = coalesce(answered_at, now())
        where id = $1
      `,
      [this.callSessionId, this.callSid, this.callerNumber]
    );

    await this.appendCallEvent('system', 'system', 'twilio.start', {
      streamSid: this.streamSid,
      callSid: this.callSid,
      mediaFormat: message.start.mediaFormat ?? null
    });

    await this.connectOpenAi();

    this.broadcast({
      type: 'twilio.started',
      callSessionId: this.callSessionId,
      streamSid: this.streamSid,
      callSid: this.callSid
    });
  }

  private async handleMedia(message: z.infer<typeof twilioMediaSchema>) {
    if (message.media.track !== 'inbound') {
      return;
    }

    if (this.aiSuspended) {
      return;
    }

    if (!this.openAiSocket || this.openAiSocket.readyState !== this.openAiSocket.OPEN) {
      return;
    }

    this.openAiSocket.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: message.media.payload
      })
    );
  }

  private async handleDtmf(message: z.infer<typeof twilioDtmfSchema>) {
    await this.appendCallEvent('system', 'system', 'twilio.dtmf', {
      digit: message.dtmf.digit
    });

    this.broadcast({
      type: 'twilio.dtmf',
      callSessionId: this.callSessionId,
      digit: message.dtmf.digit
    });
  }

  private async handleStop(message: z.infer<typeof twilioStopSchema>) {
    await this.appendCallEvent('system', 'system', 'twilio.stop', {
      streamSid: message.streamSid,
      callSid: message.stop.callSid
    });

    const transcriptFull = this.app.realtimeHub.buildTranscript(this.callSessionId);
    const runtime = this.app.realtimeHub.getRuntime(this.callSessionId);

    await finalizeCallSession(this.app, {
      callSessionId: this.callSessionId,
      transcriptFull: transcriptFull || null,
      transcriptSummary: {
        source: 'twilio_media_stream',
        state: runtime?.state ?? {}
      }
    });

    this.broadcast({
      type: 'twilio.stopped',
      callSessionId: this.callSessionId,
      summaryGenerated: true
    });

    this.close();
  }

  private async connectOpenAi() {
    if (this.openAiSocket || !env.OPENAI_API_KEY) {
      return;
    }

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(
      env.OPENAI_REALTIME_MODEL
    )}`;
    this.openAiSocket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    this.openAiSocket.on('open', () => {
      this.app.log.info(
        {
          route: 'openai.realtime',
          callSessionId: this.callSessionId
        },
        'OpenAI realtime websocket opened'
      );
      this.scheduleGreetingFallback();
      this.sendOpenAiEvent({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: env.OPENAI_REALTIME_MODEL,
          output_modalities: ['audio'],
          audio: {
            input: {
              format: {
                type: 'audio/pcmu'
              },
              transcription: {
                model: env.OPENAI_REALTIME_TRANSCRIBE_MODEL,
                language: env.OPENAI_REALTIME_LANGUAGE,
                prompt:
                  'LANstar, ipTIME, NEXI, NEXT, 네트워크 장비, 모델명, 케이블 길이와 색상은 정확히 유지합니다.'
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
                create_response: false,
                interrupt_response: true
              }
            },
            output: {
              format: {
                type: 'audio/pcmu'
              },
              voice: env.OPENAI_REALTIME_VOICE
            }
          },
          instructions: buildRealtimeInstructions()
        }
      });
    });

    this.openAiSocket.on('message', (raw: RawData) => {
      void this.handleOpenAiMessage(raw.toString());
    });

    this.openAiSocket.on('close', () => {
      this.app.log.info(
        {
          route: 'openai.realtime',
          callSessionId: this.callSessionId
        },
        'OpenAI realtime websocket closed'
      );
      this.openAiSocket = null;
      this.clearGreetingFallbackTimer();
      this.responseActive = false;
      this.sessionReady = false;
    });

    this.openAiSocket.on('error', async (error) => {
      this.app.log.error(
        {
          route: 'openai.realtime',
          callSessionId: this.callSessionId,
          message: error.message
        },
        'OpenAI realtime websocket error'
      );
      await this.appendCallEvent('system', 'system', 'openai.error', {
        message: error.message
      });
      this.broadcast({
        type: 'openai.error',
        callSessionId: this.callSessionId,
        message: error.message
      });
    });
  }

  private async handleOpenAiMessage(raw: string) {
    let event: Record<string, unknown>;

    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const eventType = typeof event.type === 'string' ? event.type : null;

    if (!eventType) {
      return;
    }

    if ((eventType === 'session.created' || eventType === 'session.updated') && !this.greetingSent) {
      this.app.log.info(
        {
          route: 'openai.realtime',
          callSessionId: this.callSessionId,
          eventType
        },
        'OpenAI realtime session ready'
      );
      this.sessionReady = true;
      this.clearGreetingFallbackTimer();
      this.greetingSent = true;
      await this.injectGreeting();
      return;
    }

    if (eventType === 'input_audio_buffer.speech_started') {
      if (this.aiSuspended) {
        return;
      }

      this.responseActive = false;
      this.sendTwilioControl('clear');
      this.sendOpenAiEvent({
        type: 'response.cancel'
      });
      return;
    }

    if (eventType === 'conversation.item.input_audio_transcription.completed') {
      const transcript = readString(event.transcript);

      if (!transcript) {
        return;
      }

      await this.handleCustomerTranscript(transcript);
      return;
    }

    if (eventType === 'response.output_audio.delta' || eventType === 'response.audio.delta') {
      if (this.aiSuspended) {
        return;
      }

      const delta = readString(event.delta);

      if (!delta || !this.streamSid) {
        return;
      }

      this.responseActive = true;
      this.twilioSocket.send(
        JSON.stringify({
          event: 'media',
          streamSid: this.streamSid,
          media: {
            payload: delta
          }
        })
      );
      return;
    }

    if (eventType === 'response.output_audio_transcript.delta') {
      if (this.aiSuspended) {
        return;
      }

      const delta = readString(event.delta);

      if (delta) {
        this.aiTranscriptBuffer += delta;
      }
      return;
    }

    if (eventType === 'response.output_audio_transcript.done') {
      if (this.aiSuspended) {
        this.aiTranscriptBuffer = '';
        return;
      }

      const transcript = readString(event.transcript) ?? this.aiTranscriptBuffer;
      this.aiTranscriptBuffer = '';

      if (transcript) {
        await this.handleAiTranscript(transcript);
      }
      return;
    }

    if (eventType === 'response.done') {
      this.responseActive = false;
      return;
    }

    if (eventType === 'error') {
      this.app.log.error(
        {
          route: 'openai.realtime',
          callSessionId: this.callSessionId,
          error: event
        },
        'OpenAI realtime event error'
      );
      await this.appendCallEvent('system', 'system', 'openai.error', {
        error: event
      });
      this.broadcast({
        type: 'openai.error',
        callSessionId: this.callSessionId,
        error: event
      });
    }
  }

  private async handleCustomerTranscript(transcript: string) {
    const createdAt = new Date().toISOString();
    this.app.realtimeHub.addTranscriptLine(this.callSessionId, {
      speaker: 'customer',
      text: transcript,
      createdAt
    });

    await this.appendCallEvent('asr', 'customer', transcript, {
      source: 'openai_realtime_transcription'
    });

    this.broadcast({
      type: 'transcript.final',
      callSessionId: this.callSessionId,
      speaker: 'customer',
      text: transcript,
      at: createdAt
    });

    const analyzeInput: AnalyzeTurnInput = {
      callSessionId: this.callSessionId,
      utterance: transcript,
      persistEvent: true,
      state: this.app.realtimeHub.getState(this.callSessionId)
    };

    if (this.callerNumber) {
      analyzeInput.callerNumber = this.callerNumber;
    }

    const analysis = await analyzeTurn(this.app, analyzeInput);
    const mergedState = this.app.realtimeHub.patchState(this.callSessionId, analysis.statePatch);

    this.broadcast({
      type: 'analysis',
      callSessionId: this.callSessionId,
      data: analysis
    });

    await this.respondToAnalysis(analysis, mergedState);
  }

  private async handleAiTranscript(transcript: string) {
    const createdAt = new Date().toISOString();
    this.app.realtimeHub.addTranscriptLine(this.callSessionId, {
      speaker: 'ai',
      text: transcript,
      createdAt
    });

    await this.appendCallEvent('ai_reply', 'ai', transcript, {
      source: 'openai_realtime_output'
    });

    this.broadcast({
      type: 'transcript.final',
      callSessionId: this.callSessionId,
      speaker: 'ai',
      text: transcript,
      at: createdAt
    });
  }

  private async injectGreeting() {
    if (this.aiSuspended) {
      return;
    }

    this.app.log.info(
      {
        route: 'openai.realtime',
        callSessionId: this.callSessionId,
        sessionReady: this.sessionReady
      },
      'Injecting greeting response'
    );

    this.sendOpenAiEvent({
      type: 'response.create',
      response: {
        output_modalities: ['audio'],
        instructions: buildGreetingMessage()
      }
    });
  }

  private async respondToAnalysis(
    analysis: Awaited<ReturnType<typeof analyzeTurn>>,
    state: ConversationState
  ) {
    if (this.aiSuspended) {
      return;
    }

    const resolution = await resolveTurnResponse(this.app, {
      analysis,
      state,
      callSessionId: this.callSessionId,
      persistDraft: true,
      autoSaveToErp: true
    });

    if (resolution.statePatch) {
      this.app.realtimeHub.patchState(this.callSessionId, resolution.statePatch);
    }

    if (resolution.source === 'workflow_failure' && resolution.error) {
      await this.appendCallEvent(
        'system',
        'system',
        'workflow.order_auto.error',
        {
          message: resolution.error
        }
      );
    }

    const approvedResponse =
      typeof resolution.responseText === 'string' ? resolution.responseText.trim() : '';

    if (!approvedResponse) {
      return;
    }

    const turnInstructions = buildApprovedTurnInstructions(approvedResponse, {
      handoffTarget: analysis.handoffRequired ? analysis.handoffTarget : 'none'
    });

    if (!turnInstructions) {
      return;
    }

    await this.respondWithApprovedPrompt(turnInstructions);
  }

  private async respondWithApprovedPrompt(turnInstructions: string) {
    this.app.log.info(
      {
        route: 'openai.realtime',
        callSessionId: this.callSessionId,
        promptLength: turnInstructions.length
      },
      'Sending approved response to OpenAI realtime'
    );
    this.sendTwilioControl('clear');
    this.sendOpenAiEvent({
      type: 'response.cancel'
    });
    this.sendOpenAiEvent({
      type: 'response.create',
      response: {
        output_modalities: ['audio'],
        instructions: turnInstructions
      }
    });
  }

  private sendTwilioControl(event: 'clear') {
    if (!this.streamSid || this.twilioSocket.readyState !== this.twilioSocket.OPEN) {
      return;
    }

    this.twilioSocket.send(
      JSON.stringify({
        event,
        streamSid: this.streamSid
      })
    );
  }

  private sendOpenAiEvent(payload: Record<string, unknown>) {
    if (!this.openAiSocket || this.openAiSocket.readyState !== this.openAiSocket.OPEN) {
      return;
    }

    this.openAiSocket.send(JSON.stringify(payload));
  }

  private scheduleGreetingFallback() {
    this.clearGreetingFallbackTimer();
    this.greetingFallbackTimer = setTimeout(() => {
      if (this.closed || this.greetingSent || this.aiSuspended) {
        return;
      }

      this.greetingSent = true;
      void this.injectGreeting();
    }, 1200);
  }

  private clearGreetingFallbackTimer() {
    if (!this.greetingFallbackTimer) {
      return;
    }

    clearTimeout(this.greetingFallbackTimer);
    this.greetingFallbackTimer = null;
  }

  private async appendCallEvent(
    eventType: 'asr' | 'ai_reply' | 'erp_call' | 'human_note' | 'handoff' | 'sms' | 'email' | 'system',
    speaker: 'customer' | 'ai' | 'manager' | 'agent' | 'system',
    content: string,
    metadata: Record<string, unknown>
  ) {
    await this.app.db.query(
      `
        insert into aicc.call_event (
          call_session_id,
          event_type,
          speaker,
          content,
          metadata
        )
        values ($1, $2::aicc.call_event_t, $3::aicc.speaker_t, $4, $5)
      `,
      [this.callSessionId, eventType, speaker, content, JSON.stringify(metadata)]
    );
  }

  private broadcast(message: Record<string, unknown>) {
    this.app.realtimeHub.broadcastSession(this.callSessionId, message);
  }
}

function parseTwilioMessage(raw: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid Twilio media message');
  }

  return twilioMessageSchema.parse(parsed);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
