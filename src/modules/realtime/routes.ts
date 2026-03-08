import type { FastifyPluginAsync } from 'fastify';
import type { RawData, WebSocket as RealtimeSocket } from 'ws';
import { z } from 'zod';

import { analyzeTurn, type AnalyzeTurnInput, type ConversationState } from '../orchestrator/service';
import { createHttpError } from '../../lib/http';
import { normalizeDigits } from '../../lib/normalize';
import { env } from '../../config/env';
import type { RealtimeRole } from './hub';
import { finalizeCallSession } from '../calls/finalize-service';

const speakerSchema = z.enum(['customer', 'ai', 'manager', 'agent', 'system']);
const eventTypeSchema = z.enum([
  'asr',
  'ai_reply',
  'erp_call',
  'human_note',
  'handoff',
  'sms',
  'email',
  'system'
]);
const handoffTargetSchema = z.enum(['sales', 'tech', 'none']);
const callStatusSchema = z.enum(['ringing', 'live', 'handoff', 'completed', 'failed']);
const callIntentSchema = z.enum(['order', 'inventory', 'quote', 'tech', 'other']);

const conversationStatePatchSchema = z.object({
  intentType: callIntentSchema.optional(),
  customerId: z.string().uuid().optional(),
  customerConfirmed: z.boolean().optional(),
  orderConfirmed: z.boolean().optional(),
  pendingConfirmation: z.enum(['customer', 'product', 'order']).nullable().optional(),
  customerType: z.enum(['existing', 'new']).optional(),
  brand: z.string().trim().optional(),
  productQuery: z.string().trim().optional(),
  productId: z.string().uuid().optional(),
  productCode: z.string().trim().optional(),
  productName: z.string().trim().optional(),
  pendingProductId: z.string().uuid().optional(),
  pendingProductCode: z.string().trim().optional(),
  pendingProductName: z.string().trim().optional(),
  qty: z.coerce.number().positive().optional(),
  shippingMethod: z
    .enum([
      'delivery',
      'pickup',
      'courier_rogen',
      'courier_kd_parcel',
      'courier_kd_freight',
      'quick'
    ])
    .optional(),
  warehouseCode: z.enum(['10', '30']).optional(),
  assistantRepeatCount: z.coerce.number().int().min(0).optional(),
  repeatedQuestionCount: z.coerce.number().int().min(0).optional(),
  elapsedSeconds: z.coerce.number().int().min(0).optional(),
  repairCount: z.coerce.number().int().min(0).optional(),
  customerCandidateCount: z.coerce.number().int().min(0).optional(),
  productCandidateCount: z.coerce.number().int().min(0).optional(),
  customerResolutionMode: z
    .enum(['selected', 'phone_exact', 'name_exact', 'phone_name_fuzzy', 'candidate_only', 'unresolved'])
    .optional(),
  productResolutionMode: z
    .enum(['selected', 'item_exact', 'model_exact', 'compact_exact', 'candidate_only', 'unresolved'])
    .optional(),
  conversationStage: z
    .enum(['opening', 'customer', 'product', 'quantity', 'delivery', 'confirmation', 'inventory', 'quote', 'tech', 'handoff', 'resolved'])
    .optional(),
  lastCustomerNameHint: z.string().trim().optional(),
  lastProductQuery: z.string().trim().optional(),
  lastSuggestedPrompt: z.string().trim().optional()
});

const hintSchema = z.object({
  customerName: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  productQuery: z.string().trim().optional(),
  qty: z.coerce.number().positive().optional(),
  shippingMethod: z.string().trim().optional()
});

const websocketQuerySchema = z.object({
  role: z.enum(['provider', 'manager', 'monitor']).default('provider'),
  token: z.string().trim().optional()
});

const bootstrapBodySchema = z.object({
  providerCallId: z.string().trim().optional(),
  callerNumber: z.string().trim().min(1),
  customerId: z.string().uuid().optional(),
  intentType: callIntentSchema.optional(),
  status: z.enum(['ringing', 'live']).default('ringing')
});

const sessionStartMessageSchema = z.object({
  type: z.literal('session.start'),
  callerNumber: z.string().trim().optional(),
  providerCallId: z.string().trim().optional(),
  customerId: z.string().uuid().optional(),
  intentType: callIntentSchema.optional(),
  answeredAt: z.string().datetime().optional()
});

const transcriptMessageSchema = z.object({
  type: z.enum(['transcript.partial', 'transcript.final']),
  speaker: speakerSchema,
  text: z.string().trim().min(1),
  at: z.string().datetime().optional(),
  hints: hintSchema.optional(),
  state: conversationStatePatchSchema.optional()
});

const genericEventMessageSchema = z.object({
  type: z.literal('event'),
  eventType: eventTypeSchema,
  speaker: speakerSchema.default('system'),
  content: z.string().trim().optional(),
  metadata: z.record(z.any()).default({})
});

const managerCommandMessageSchema = z.object({
  type: z.literal('manager.command'),
  action: z.enum(['note', 'takeover', 'ai_instruction']),
  target: handoffTargetSchema.optional(),
  content: z.string().trim().optional(),
  metadata: z.record(z.any()).default({})
});

const sessionEndMessageSchema = z.object({
  type: z.literal('session.end'),
  status: z.enum(['handoff', 'completed', 'failed']).default('completed'),
  handoffRequired: z.boolean().default(false),
  handoffTarget: handoffTargetSchema.default('none'),
  handoffReason: z.string().trim().optional(),
  transcriptSummary: z.record(z.any()).default({})
});

const websocketMessageSchema = z.discriminatedUnion('type', [
  sessionStartMessageSchema,
  transcriptMessageSchema,
  genericEventMessageSchema,
  managerCommandMessageSchema,
  sessionEndMessageSchema
]);

const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/bootstrap', async (request, reply) => {
    const body = bootstrapBodySchema.parse(request.body);
    const result = await app.db.query(
      `
        insert into aicc.call_session (
          provider_call_id,
          customer_id,
          caller_number,
          caller_number_digits,
          intent_type,
          status
        )
        values ($1, $2, $3, $4, $5, $6)
        returning id, provider_call_id, caller_number, status, created_at
      `,
      [
        body.providerCallId ?? null,
        body.customerId ?? null,
        body.callerNumber,
        normalizeDigits(body.callerNumber),
        body.intentType ?? null,
        body.status
      ]
    );
    const callSession = result.rows[0];

    app.realtimeHub.setCaller(callSession.id, body.callerNumber);

    if (body.providerCallId) {
      app.realtimeHub.setProviderCallId(callSession.id, body.providerCallId);
    }

    return reply.status(201).send({
      ...callSession,
      ws: {
        providerPath: `/api/v1/realtime/ws/calls/${callSession.id}?role=provider`,
        managerPath: `/api/v1/realtime/ws/calls/${callSession.id}?role=manager`,
        monitorPath: `/api/v1/realtime/ws/monitor?role=monitor`
      }
    });
  });

  app.get('/sessions/:id/runtime', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    return app.realtimeHub.getSnapshot(params.id);
  });

  app.get(
    '/ws/calls/:id',
    { websocket: true },
    (socket, request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const query = websocketQuerySchema.parse(request.query);

      if (!authorizeSocket(request.headers['x-realtime-token'], query.token)) {
        sendJson(socket, {
          type: 'error',
          message: 'Unauthorized websocket token'
        });
        socket.close(1008, 'Unauthorized');
        return;
      }

      app.realtimeHub.join({
        socket,
        role: query.role,
        scope: 'session',
        callSessionId: params.id
      });

      sendJson(socket, {
        type: 'connected',
        role: query.role,
        scope: 'session',
        callSessionId: params.id,
        snapshot: app.realtimeHub.getSnapshot(params.id)
      });

      attachSocketHandlers(app, socket, {
        callSessionId: params.id,
        role: query.role
      });
    }
  );

  app.get(
    '/ws/monitor',
    { websocket: true },
    (socket, request) => {
      const query = websocketQuerySchema.parse(request.query);

      if (!authorizeSocket(request.headers['x-realtime-token'], query.token)) {
        sendJson(socket, {
          type: 'error',
          message: 'Unauthorized websocket token'
        });
        socket.close(1008, 'Unauthorized');
        return;
      }

      app.realtimeHub.join({
        socket,
        role: query.role,
        scope: 'global'
      });

      sendJson(socket, {
        type: 'connected',
        role: query.role,
        scope: 'global'
      });

      attachSocketHandlers(app, socket, {
        role: query.role
      });
    }
  );
};

function attachSocketHandlers(
  app: Parameters<FastifyPluginAsync>[0],
  socket: RealtimeSocket,
  context: {
    role: RealtimeRole;
    callSessionId?: string;
  }
) {
  socket.on('message', async (raw: RawData) => {
    try {
      const message = parseMessage(raw.toString());

      if (message.type === 'session.start') {
        if (!context.callSessionId) {
          throw createHttpError(400, 'session.start requires callSessionId');
        }

        await handleSessionStart(app, context.callSessionId, message);
        return;
      }

      if (message.type === 'transcript.partial') {
        if (!context.callSessionId) {
          throw createHttpError(400, 'transcript.partial requires callSessionId');
        }

        handleTranscriptPartial(app, context.callSessionId, message);
        return;
      }

      if (message.type === 'transcript.final') {
        if (!context.callSessionId) {
          throw createHttpError(400, 'transcript.final requires callSessionId');
        }

        await handleTranscriptFinal(app, context.callSessionId, message);
        return;
      }

      if (message.type === 'event') {
        if (!context.callSessionId) {
          throw createHttpError(400, 'event requires callSessionId');
        }

        await handleGenericEvent(app, context.callSessionId, message);
        return;
      }

      if (message.type === 'manager.command') {
        if (!context.callSessionId) {
          throw createHttpError(400, 'manager.command requires callSessionId');
        }

        await handleManagerCommand(app, context.callSessionId, message);
        return;
      }

      if (message.type !== 'session.end') {
        throw createHttpError(400, 'Unsupported realtime message');
      }

      if (!context.callSessionId) {
        throw createHttpError(400, 'session.end requires callSessionId');
      }

      await handleSessionEnd(app, context.callSessionId, message);
    } catch (error) {
      sendJson(socket, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Invalid realtime message'
      });
    }
  });

  socket.on('close', () => {
    app.realtimeHub.leave(socket);
  });
}

async function handleSessionStart(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  message: z.infer<typeof sessionStartMessageSchema>
) {
  if (message.callerNumber) {
    app.realtimeHub.setCaller(callSessionId, message.callerNumber);
  }

  if (message.providerCallId) {
    app.realtimeHub.setProviderCallId(callSessionId, message.providerCallId);
  }

  const updateResult = await app.db.query(
    `
      update aicc.call_session
      set
        provider_call_id = coalesce(provider_call_id, $2),
        customer_id = coalesce(customer_id, $3::uuid),
        caller_number = coalesce($4, caller_number),
        caller_number_digits = coalesce($5, caller_number_digits),
        intent_type = coalesce(intent_type, $6::aicc.call_intent_t),
        status = 'live',
        answered_at = coalesce(answered_at, $7::timestamptz, now())
      where id = $1
      returning id
    `,
    [
      callSessionId,
      message.providerCallId ?? null,
      message.customerId ?? null,
      message.callerNumber ?? null,
      normalizeDigits(message.callerNumber),
      message.intentType ?? null,
      message.answeredAt ?? null
    ]
  );

  if (updateResult.rowCount === 0) {
    throw createHttpError(404, 'Call session not found');
  }

  await appendCallEvent(app, callSessionId, {
    eventType: 'system',
    speaker: 'system',
    content: 'session.start',
    metadata: {
      providerCallId: message.providerCallId ?? null,
      callerNumber: message.callerNumber ?? null,
      intentType: message.intentType ?? null
    }
  });

  app.realtimeHub.broadcastSession(callSessionId, {
    type: 'session.started',
    callSessionId,
    snapshot: app.realtimeHub.getSnapshot(callSessionId)
  });
}

function handleTranscriptPartial(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  message: z.infer<typeof transcriptMessageSchema>
) {
  app.realtimeHub.broadcastSession(callSessionId, {
    type: 'transcript.partial',
    callSessionId,
    speaker: message.speaker,
    text: message.text,
    at: message.at ?? new Date().toISOString()
  });
}

async function handleTranscriptFinal(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  message: z.infer<typeof transcriptMessageSchema>
) {
  if (message.state) {
    app.realtimeHub.patchState(callSessionId, message.state as ConversationState);
  }

  app.realtimeHub.addTranscriptLine(callSessionId, {
    speaker: message.speaker,
    text: message.text,
    createdAt: message.at ?? new Date().toISOString()
  });

  const eventType =
    message.speaker === 'customer'
      ? 'asr'
      : message.speaker === 'ai'
        ? 'ai_reply'
        : message.speaker === 'system'
          ? 'system'
          : 'human_note';

  await appendCallEvent(app, callSessionId, {
    eventType,
    speaker: message.speaker,
    content: message.text,
    metadata: {
      final: true,
      at: message.at ?? null
    }
  });

  app.realtimeHub.broadcastSession(callSessionId, {
    type: 'transcript.final',
    callSessionId,
    speaker: message.speaker,
    text: message.text,
    at: message.at ?? new Date().toISOString()
  });

  if (message.speaker !== 'customer') {
    return;
  }

  const runtime = app.realtimeHub.getRuntime(callSessionId);
  const input: AnalyzeTurnInput = {
    callSessionId,
    utterance: message.text,
    persistEvent: true,
    state: app.realtimeHub.getState(callSessionId)
  };

  if (runtime?.callerNumber) {
    input.callerNumber = runtime.callerNumber;
  }

  if (message.hints) {
    const hints: AnalyzeTurnInput['hints'] = {};

    if (message.hints.customerName) {
      hints.customerName = message.hints.customerName;
    }

    if (message.hints.brand) {
      hints.brand = message.hints.brand;
    }

    if (message.hints.productQuery) {
      hints.productQuery = message.hints.productQuery;
    }

    if (message.hints.qty !== undefined) {
      hints.qty = message.hints.qty;
    }

    if (message.hints.shippingMethod) {
      hints.shippingMethod = message.hints.shippingMethod;
    }

    input.hints = hints;
  }

  const analysis = await analyzeTurn(app, input);
  app.realtimeHub.patchState(callSessionId, analysis.statePatch);

  app.realtimeHub.broadcastSession(callSessionId, {
    type: 'analysis',
    callSessionId,
    data: analysis
  });
}

async function handleGenericEvent(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  message: z.infer<typeof genericEventMessageSchema>
) {
  await appendCallEvent(app, callSessionId, {
    eventType: message.eventType,
    speaker: message.speaker,
    content: message.content ?? null,
    metadata: message.metadata
  });

  app.realtimeHub.broadcastSession(callSessionId, {
    type: 'event',
    callSessionId,
    data: message
  });
}

async function handleManagerCommand(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  message: z.infer<typeof managerCommandMessageSchema>
) {
  const control = app.callControlRegistry.get(callSessionId);

  if (message.action === 'takeover') {
    if (control) {
      await control.takeover(message.target ?? 'sales', message.content ?? 'manager_takeover');
      return;
    }

    await app.db.query(
      `
        update aicc.call_session
        set
          handoff_required = true,
          handoff_target = $2::aicc.handoff_target_t,
          handoff_reason = $3,
          status = 'handoff'
        where id = $1
      `,
      [callSessionId, message.target ?? 'sales', message.content ?? 'manager_takeover']
    );

    await appendCallEvent(app, callSessionId, {
      eventType: 'handoff',
      speaker: 'manager',
      content: message.content ?? message.action,
      metadata: {
        action: message.action,
        target: message.target ?? null,
        ...message.metadata
      }
    });

    app.realtimeHub.broadcastSession(callSessionId, {
      type: 'manager.command',
      callSessionId,
      action: message.action,
      target: message.target ?? null,
      content: message.content ?? null,
      metadata: message.metadata
    });
    return;
  }

  if (message.action === 'ai_instruction') {
    if (message.content && control) {
      await control.injectAiInstruction(message.content);
      return;
    }

    await appendCallEvent(app, callSessionId, {
      eventType: 'human_note',
      speaker: 'manager',
      content: message.content ?? message.action,
      metadata: {
        action: message.action,
        target: message.target ?? null,
        queued: true,
        ...message.metadata
      }
    });

    app.realtimeHub.broadcastSession(callSessionId, {
      type: 'manager.command',
      callSessionId,
      action: message.action,
      target: message.target ?? null,
      content: message.content ?? null,
      metadata: message.metadata
    });
    return;
  }

  await appendCallEvent(app, callSessionId, {
    eventType: 'human_note',
    speaker: 'manager',
    content: message.content ?? message.action,
    metadata: {
      action: message.action,
      target: message.target ?? null,
      ...message.metadata
    }
  });

  app.realtimeHub.broadcastSession(callSessionId, {
    type: 'manager.command',
    callSessionId,
    action: message.action,
    target: message.target ?? null,
    content: message.content ?? null,
    metadata: message.metadata
  });
}

async function handleSessionEnd(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  message: z.infer<typeof sessionEndMessageSchema>
) {
  const transcriptFull = app.realtimeHub.buildTranscript(callSessionId);
  const runtime = app.realtimeHub.getRuntime(callSessionId);

  await finalizeCallSession(app, {
    callSessionId,
    status: message.status,
    handoffRequired: message.handoffRequired,
    handoffTarget: message.handoffTarget,
    handoffReason: message.handoffReason ?? null,
    transcriptFull: transcriptFull || null,
    transcriptSummary: {
      ...message.transcriptSummary,
      state: runtime?.state ?? {}
    }
  });

  await appendCallEvent(app, callSessionId, {
    eventType: message.handoffRequired ? 'handoff' : 'system',
    speaker: 'system',
    content: 'session.end',
    metadata: {
      status: message.status,
      handoffRequired: message.handoffRequired,
      handoffTarget: message.handoffTarget,
      handoffReason: message.handoffReason ?? null
    }
  });

  app.realtimeHub.broadcastSession(callSessionId, {
    type: 'session.completed',
    callSessionId,
    status: message.status,
    handoffRequired: message.handoffRequired,
    handoffTarget: message.handoffTarget,
    handoffReason: message.handoffReason ?? null,
    summaryGenerated: true
  });
}

async function appendCallEvent(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  input: {
    eventType: z.infer<typeof eventTypeSchema>;
    speaker: z.infer<typeof speakerSchema>;
    content: string | null;
    metadata: Record<string, unknown>;
  }
) {
  await app.db.query(
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
    [callSessionId, input.eventType, input.speaker, input.content, JSON.stringify(input.metadata)]
  );
}

function parseMessage(raw: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createHttpError(400, 'Invalid JSON message');
  }

  return websocketMessageSchema.parse(parsed);
}

function authorizeSocket(headerValue: unknown, queryToken?: string) {
  if (!env.REALTIME_WS_TOKEN) {
    return true;
  }

  const headerToken =
    typeof headerValue === 'string'
      ? headerValue
      : Array.isArray(headerValue)
        ? headerValue[0]
        : null;

  return headerToken === env.REALTIME_WS_TOKEN || queryToken === env.REALTIME_WS_TOKEN;
}

function sendJson(socket: RealtimeSocket, payload: Record<string, unknown>) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export default realtimeRoutes;
