import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env';
import { createHttpError } from '../../lib/http';
import { normalizeDigits } from '../../lib/normalize';
import { OpenAiRealtimeBridge } from './openai-realtime-bridge';
import { buildTwilioRequestUrl, validateTwilioSignature } from './signature';

const inboundBodySchema = z.object({
  CallSid: z.string().trim().min(1),
  From: z.string().trim().min(1),
  To: z.string().trim().optional(),
  Direction: z.string().trim().optional()
});

const statusBodySchema = z.object({
  CallSid: z.string().trim().min(1),
  CallStatus: z.string().trim().min(1)
});

const mediaStreamParamsSchema = z.object({
  callSessionId: z.string().uuid(),
  token: z.string().trim().optional()
});

const twilioRoutes: FastifyPluginAsync = async (app) => {
  app.post('/voice/inbound', async (request, reply) => {
    assertValidTwilioRequest(request);
    const body = inboundBodySchema.parse(request.body);
    app.log.info(
      {
        route: 'twilio.voice.inbound',
        callSid: body.CallSid,
        from: body.From,
        to: body.To ?? null
      },
      'Twilio inbound webhook received'
    );
    const result = await app.db.query(
      `
        insert into aicc.call_session (
          provider_call_id,
          caller_number,
          caller_number_digits,
          status
        )
        values ($1, $2, $3, 'ringing')
        on conflict (provider_call_id)
        do update
          set caller_number = excluded.caller_number,
              caller_number_digits = excluded.caller_number_digits
        returning id, provider_call_id, caller_number
      `,
      [body.CallSid, body.From, normalizeDigits(body.From)]
    );
    const callSession = result.rows[0];

    app.realtimeHub.setProviderCallId(callSession.id, body.CallSid);
    app.realtimeHub.setCaller(callSession.id, body.From);

    const mediaUrl = buildMediaStreamUrl(request, callSession.id);
    const xml = buildTwimlResponse({
      mediaUrl,
      callerNumber: body.From,
      callSessionId: callSession.id
    });

    app.log.info(
      {
        route: 'twilio.voice.inbound',
        callSessionId: callSession.id,
        callSid: body.CallSid,
        mediaUrl
      },
      'Twilio inbound webhook responded with media stream TwiML'
    );

    reply.header('content-type', 'text/xml; charset=utf-8');
    return reply.send(xml);
  });

  app.post('/voice/status', async (request, reply) => {
    assertValidTwilioRequest(request);
    const body = statusBodySchema.parse(request.body);
    const mappedStatus = mapTwilioStatus(body.CallStatus);
    const transcriptFull = await loadTranscriptForCall(app, body.CallSid);
    app.log.info(
      {
        route: 'twilio.voice.status',
        callSid: body.CallSid,
        callStatus: body.CallStatus,
        mappedStatus
      },
      'Twilio status webhook received'
    );

    await app.db.query(
      `
        update aicc.call_session
        set
          status = $2::aicc.call_status_t,
          transcript_full = coalesce($3, transcript_full),
          ended_at = case
            when $2::aicc.call_status_t in ('completed', 'failed') then coalesce(ended_at, now())
            else ended_at
          end
        where provider_call_id = $1
      `,
      [body.CallSid, mappedStatus, transcriptFull]
    );

    return reply.status(204).send();
  });

  app.get(
    '/media-stream/:callSessionId/:token?',
    { websocket: true },
    (socket, request) => {
      const params = mediaStreamParamsSchema.parse(request.params);

      if (!authorizeTwilioStream(params.token)) {
        app.log.warn(
          {
            route: 'twilio.media-stream',
            callSessionId: params.callSessionId
          },
          'Twilio media stream rejected due to token mismatch'
        );
        socket.close(1008, 'Unauthorized');
        return;
      }

      app.log.info(
        {
          route: 'twilio.media-stream',
          callSessionId: params.callSessionId
        },
        'Twilio media stream websocket accepted'
      );

      const bridge = new OpenAiRealtimeBridge(app, socket, params.callSessionId);

      socket.on('message', (raw) => {
        void bridge.handleTwilioMessage(raw);
      });

      socket.on('close', () => {
        bridge.close();
      });

      socket.on('error', () => {
        bridge.close();
      });
    }
  );
};

function buildMediaStreamUrl(
  request: FastifyRequest,
  callSessionId: string
) {
  const publicBaseUrl = env.PUBLIC_BASE_URL ?? inferPublicBaseUrl(request);

  if (!publicBaseUrl) {
    throw createHttpError(500, 'PUBLIC_BASE_URL is required for Twilio media stream');
  }

  const wsBaseUrl = publicBaseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const pathSegments = ['/api/v1/twilio/media-stream', encodeURIComponent(callSessionId)];

  if (env.TWILIO_STREAM_TOKEN) {
    pathSegments.push(encodeURIComponent(env.TWILIO_STREAM_TOKEN));
  }

  return new URL(pathSegments.join('/'), wsBaseUrl).toString();
}

function inferPublicBaseUrl(request: {
  headers: Record<string, unknown>;
}) {
  const host = typeof request.headers.host === 'string' ? request.headers.host : null;
  const forwardedProto =
    typeof request.headers['x-forwarded-proto'] === 'string'
      ? request.headers['x-forwarded-proto']
      : null;
  const proto = forwardedProto ?? 'https';

  return host ? `${proto}://${host}` : null;
}

function buildTwimlResponse(input: {
  mediaUrl: string;
  callerNumber: string;
  callSessionId: string;
}) {
  const callerNumber = escapeXml(input.callerNumber);
  const callSessionId = escapeXml(input.callSessionId);
  const mediaUrl = escapeXml(input.mediaUrl);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '  <Connect>',
    `    <Stream url="${mediaUrl}">`,
    `      <Parameter name="callerNumber" value="${callerNumber}" />`,
    `      <Parameter name="callSessionId" value="${callSessionId}" />`,
    '    </Stream>',
    '  </Connect>',
    '</Response>'
  ].join('\n');
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function authorizeTwilioStream(token?: string) {
  if (!env.TWILIO_STREAM_TOKEN) {
    return true;
  }

  return token === env.TWILIO_STREAM_TOKEN;
}

function assertValidTwilioRequest(request: FastifyRequest) {
  if (!env.TWILIO_AUTH_TOKEN) {
    return;
  }

  const signature = request.headers['x-twilio-signature'];

  if (typeof signature !== 'string' || !signature.trim()) {
    throw createHttpError(403, 'Missing Twilio signature');
  }

  const url = buildTwilioRequestUrl(request, env.PUBLIC_BASE_URL);

  if (!url) {
    throw createHttpError(500, 'Unable to build Twilio request URL');
  }

  const body =
    request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>)
      : {};

  const valid = validateTwilioSignature({
    authToken: env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params: body
  });

  if (!valid) {
    throw createHttpError(403, 'Invalid Twilio signature');
  }
}

function mapTwilioStatus(value: string) {
  switch (value) {
    case 'queued':
    case 'ringing':
      return 'ringing';
    case 'in-progress':
      return 'live';
    case 'completed':
      return 'completed';
    default:
      return 'failed';
  }
}

async function loadTranscriptForCall(
  app: Parameters<FastifyPluginAsync>[0],
  providerCallId: string
) {
  const result = await app.db.query<{ id: string }>(
    `
      select id
      from aicc.call_session
      where provider_call_id = $1
      limit 1
    `,
    [providerCallId]
  );
  const session = result.rows[0];

  if (!session) {
    return null;
  }

  const transcript = app.realtimeHub.buildTranscript(session.id);
  return transcript || null;
}

export default twilioRoutes;
