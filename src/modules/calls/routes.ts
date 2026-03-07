import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { createHttpError } from '../../lib/http';
import { normalizeDigits } from '../../lib/normalize';
import { finalizeCallSession } from './finalize-service';

const createCallSessionBodySchema = z.object({
  providerCallId: z.string().trim().min(1).optional(),
  callerNumber: z.string().trim().min(1),
  customerId: z.string().uuid().optional(),
  intentType: z.enum(['order', 'inventory', 'quote', 'tech', 'other']).optional(),
  status: z.enum(['ringing', 'live', 'handoff', 'completed', 'failed']).default('ringing')
});

const addCallEventBodySchema = z.object({
  eventType: z.enum(['asr', 'ai_reply', 'erp_call', 'human_note', 'handoff', 'sms', 'email', 'system']),
  speaker: z.enum(['customer', 'ai', 'manager', 'agent', 'system']),
  content: z.string().trim().optional(),
  metadata: z.record(z.any()).default({})
});

const completeCallBodySchema = z.object({
  status: z.enum(['live', 'handoff', 'completed', 'failed']).default('completed'),
  handoffRequired: z.boolean().default(false),
  handoffTarget: z.enum(['sales', 'tech', 'none']).default('none'),
  handoffReason: z.string().trim().optional(),
  transcriptFull: z.string().optional(),
  transcriptSummary: z.record(z.any()).default({})
});

const callRoutes: FastifyPluginAsync = async (app) => {
  app.post('/sessions', async (request, reply) => {
    const body = createCallSessionBodySchema.parse(request.body);
    const callerNumberDigits = normalizeDigits(body.callerNumber);

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
        returning *
      `,
      [
        body.providerCallId ?? null,
        body.customerId ?? null,
        body.callerNumber,
        callerNumberDigits,
        body.intentType ?? null,
        body.status
      ]
    );

    return reply.status(201).send(result.rows[0]);
  });

  app.get('/sessions/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const [sessionResult, eventResult] = await Promise.all([
      app.db.query('select * from aicc.call_session where id = $1', [params.id]),
      app.db.query(
        `
          select id, event_type, speaker, content, metadata, created_at
          from aicc.call_event
          where call_session_id = $1
          order by created_at asc
        `,
        [params.id]
      )
    ]);

    if (sessionResult.rowCount === 0) {
      throw createHttpError(404, 'Call session not found');
    }

    return {
      ...sessionResult.rows[0],
      events: eventResult.rows
    };
  });

  app.post('/sessions/:id/events', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = addCallEventBodySchema.parse(request.body);

    const result = await app.db.query(
      `
        insert into aicc.call_event (
          call_session_id,
          event_type,
          speaker,
          content,
          metadata
        )
        values ($1, $2, $3, $4, $5)
        returning *
      `,
      [params.id, body.eventType, body.speaker, body.content ?? null, JSON.stringify(body.metadata)]
    );

    return reply.status(201).send(result.rows[0]);
  });

  app.post('/sessions/:id/complete', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = completeCallBodySchema.parse(request.body);

    const result = await finalizeCallSession(app, {
      callSessionId: params.id,
      status: body.status,
      handoffRequired: body.handoffRequired,
      handoffTarget: body.handoffTarget,
      handoffReason: body.handoffReason ?? null,
      transcriptFull: body.transcriptFull ?? null,
      transcriptSummary: body.transcriptSummary
    });

    if (!result) {
      throw createHttpError(404, 'Call session not found');
    }

    return result;
  });
};

export default callRoutes;
