import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env';
import { createHttpError } from '../../lib/http';
import { generateCallSummary } from '../calls/summary-service';
import {
  autoSendOrderDraftSummary,
  sendNotificationById,
  type NotificationChannel
} from '../notifications/service';

const listCallsQuerySchema = z.object({
  activeOnly: z
    .union([z.boolean(), z.string(), z.undefined()])
    .transform((value) => {
      if (typeof value === 'boolean') {
        return value;
      }

      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();

        if (['false', '0', 'off', 'no'].includes(normalized)) {
          return false;
        }

        if (['true', '1', 'on', 'yes'].includes(normalized)) {
          return true;
        }
      }

      return true;
    }),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const noteBodySchema = z.object({
  content: z.string().trim().min(1)
});

const takeoverBodySchema = z.object({
  target: z.enum(['sales', 'tech']).default('sales'),
  reason: z.string().trim().optional()
});

const aiInstructionBodySchema = z.object({
  instruction: z.string().trim().min(1)
});

const draftNotificationBodySchema = z.object({
  channel: z.enum(['email', 'sms', 'alimtalk']).optional()
});

type SessionListRow = {
  id: string;
  provider_call_id: string | null;
  caller_number: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  status: 'ringing' | 'live' | 'handoff' | 'completed' | 'failed';
  intent_type: 'order' | 'inventory' | 'quote' | 'tech' | 'other' | null;
  handoff_required: boolean;
  handoff_target: 'sales' | 'tech' | 'none';
  handoff_reason: string | null;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  transcript_summary?: Record<string, unknown>;
};

type EventRow = {
  id: number;
  event_type: string;
  speaker: string;
  content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type DraftRow = {
  id: string;
  draft_kind: 'sale' | 'quote';
  warehouse_code: string;
  shipping_method: string | null;
  requires_human_review: boolean;
  human_review_reason: string | null;
  total_amount: number | null;
  status: string;
  erp_slip_no: string | null;
  created_at: string;
};

type NotificationRow = {
  id: string;
  channel: 'email' | 'sms' | 'alimtalk';
  recipient: string;
  subject: string | null;
  status: 'queued' | 'sent' | 'failed';
  provider_message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    authorizeAdmin(request);
  });

  app.get('/summary', async () => {
    const result = await app.db.query<{
      status: SessionListRow['status'];
      count: string;
    }>(
      `
        select status, count(*)::text as count
        from aicc.call_session
        where started_at >= now() - interval '3 months'
        group by status
      `
    );

    const liveRuntimeCount = app.realtimeHub.listSnapshots().length;

    return {
      liveRuntimeCount,
      byStatus: result.rows.map((row) => ({
        status: row.status,
        count: Number(row.count)
      }))
    };
  });

  app.get('/calls', async (request) => {
    const query = listCallsQuerySchema.parse(request.query);
    const result = await app.db.query<SessionListRow>(
      `
        select
          cs.id,
          cs.provider_call_id,
          cs.caller_number,
          cs.started_at::text,
          cs.answered_at::text,
          cs.ended_at::text,
          cs.status,
          cs.intent_type,
          cs.handoff_required,
          cs.handoff_target,
          cs.handoff_reason,
          cs.customer_id::text,
          mc.customer_code,
          mc.customer_name
        from aicc.call_session cs
        left join aicc.master_customer mc on mc.id = cs.customer_id
        where (
          $1::boolean = false
          or cs.status in ('ringing', 'live', 'handoff')
        )
        order by coalesce(cs.answered_at, cs.started_at) desc
        limit $2
      `,
      [query.activeOnly, query.limit]
    );

    const runtimeById = new Map(
      app.realtimeHub.listSnapshots().map((snapshot) => [snapshot.callSessionId, snapshot])
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        providerCallId: row.provider_call_id,
        callerNumber: row.caller_number,
        startedAt: row.started_at,
        answeredAt: row.answered_at,
        endedAt: row.ended_at,
        status: row.status,
        intentType: row.intent_type,
        handoffRequired: row.handoff_required,
        handoffTarget: row.handoff_target,
        handoffReason: row.handoff_reason,
        customer: row.customer_id
          ? {
              id: row.customer_id,
              customerCode: row.customer_code,
              customerName: row.customer_name
            }
          : null,
        runtime: runtimeById.get(row.id) ?? null,
        bridgeActive: app.callControlRegistry.has(row.id)
      }))
    };
  });

  app.get('/calls/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const session = await loadSession(app, params.id);

    const [eventsResult, draftsResult, notificationsResult] = await Promise.all([
      app.db.query<EventRow>(
        `
          select id, event_type, speaker, content, metadata, created_at::text
          from aicc.call_event
          where call_session_id = $1
          order by created_at asc
        `,
        [params.id]
      ),
      app.db.query<DraftRow>(
        `
          select
            id,
            draft_kind,
            warehouse_code,
            shipping_method::text,
            requires_human_review,
            human_review_reason,
            total_amount,
            status::text,
            erp_slip_no,
            created_at::text
          from aicc.order_draft
          where call_session_id = $1
          order by created_at desc
          limit 5
        `,
        [params.id]
      ),
      app.db.query<NotificationRow>(
        `
          select
            id::text,
            channel,
            recipient,
            subject,
            status,
            provider_message_id,
            metadata,
            created_at::text,
            updated_at::text
          from aicc.notification_delivery
          where call_session_id = $1
          order by created_at desc
          limit 20
        `,
        [params.id]
      )
    ]);

    return {
      ...mapSessionRow(app, session),
      transcriptSummary: session.transcript_summary ?? {},
      summary:
        session.transcript_summary &&
        typeof session.transcript_summary.summary === 'object' &&
        session.transcript_summary.summary !== null
          ? session.transcript_summary.summary
          : null,
      runtime: app.realtimeHub.peekSnapshot(params.id),
      bridgeActive: app.callControlRegistry.has(params.id),
      events: eventsResult.rows,
      drafts: draftsResult.rows,
      notifications: notificationsResult.rows
    };
  });

  app.post('/calls/:id/summarize', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    await ensureSessionExists(app, params.id);
    const summary = await generateCallSummary(app, params.id, {
      force: true
    });

    app.realtimeHub.broadcastSession(params.id, {
      type: 'summary.updated',
      callSessionId: params.id,
      summary
    });

    return reply.status(201).send({
      ok: true,
      summary
    });
  });

  app.post('/calls/:id/notes', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = noteBodySchema.parse(request.body);

    await ensureSessionExists(app, params.id);
    await appendManagerEvent(app, params.id, 'human_note', body.content, {
      action: 'note'
    });
    if (app.realtimeHub.getRuntime(params.id)) {
      app.realtimeHub.addTranscriptLine(params.id, {
        speaker: 'manager',
        text: body.content,
        createdAt: new Date().toISOString()
      });
    }
    app.realtimeHub.broadcastSession(params.id, {
      type: 'manager.note',
      callSessionId: params.id,
      content: body.content
    });

    return reply.status(201).send({ ok: true });
  });

  app.post('/calls/:id/takeover', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = takeoverBodySchema.parse(request.body);

    await ensureSessionExists(app, params.id);
    const control = app.callControlRegistry.get(params.id);

    if (control) {
      await control.takeover(body.target, body.reason);
    } else {
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
        [params.id, body.target, body.reason ?? 'admin_takeover']
      );
      await appendManagerEvent(app, params.id, 'handoff', body.reason ?? 'admin_takeover', {
        action: 'takeover',
        target: body.target
      });
      app.realtimeHub.broadcastSession(params.id, {
        type: 'manager.command',
        callSessionId: params.id,
        action: 'takeover',
        target: body.target,
        content: body.reason ?? null
      });
    }

    return reply.status(202).send({ ok: true });
  });

  app.post('/calls/:id/ai-instructions', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = aiInstructionBodySchema.parse(request.body);

    await ensureSessionExists(app, params.id);
    const control = app.callControlRegistry.get(params.id);

    if (control) {
      await control.injectAiInstruction(body.instruction);
    } else {
      await appendManagerEvent(app, params.id, 'human_note', body.instruction, {
        action: 'ai_instruction',
        queued: true
      });
      app.realtimeHub.broadcastSession(params.id, {
        type: 'manager.command',
        callSessionId: params.id,
        action: 'ai_instruction',
        content: body.instruction,
        queued: true
      });
    }

    return reply.status(202).send({
      ok: true,
      applied: Boolean(control)
    });
  });

  app.post('/calls/:id/drafts/:draftId/notify', async (request, reply) => {
    const params = z
      .object({
        id: z.string().uuid(),
        draftId: z.string().uuid()
      })
      .parse(request.params);
    const body = draftNotificationBodySchema.parse(request.body ?? {});

    await ensureDraftBelongsToCall(app, params.id, params.draftId);
    const notifyInput: Parameters<typeof autoSendOrderDraftSummary>[1] = {
      draftId: params.draftId
    };

    if (body.channel) {
      notifyInput.preferredChannel = body.channel as NotificationChannel;
    }

    const result = await autoSendOrderDraftSummary(app, notifyInput);

    app.realtimeHub.broadcastSession(params.id, {
      type: 'notification.updated',
      callSessionId: params.id,
      draftId: params.draftId
    });

    return reply.status(201).send(result);
  });

  app.post('/calls/:id/notifications/:notificationId/send', async (request, reply) => {
    const params = z
      .object({
        id: z.string().uuid(),
        notificationId: z.string().uuid()
      })
      .parse(request.params);

    await ensureNotificationBelongsToCall(app, params.id, params.notificationId);
    const result = await sendNotificationById(app, params.notificationId);

    app.realtimeHub.broadcastSession(params.id, {
      type: 'notification.updated',
      callSessionId: params.id,
      notificationId: params.notificationId
    });

    return reply.status(201).send(result);
  });
};

async function loadSession(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string
) {
  const result = await app.db.query<SessionListRow>(
    `
      select
        cs.id,
        cs.provider_call_id,
        cs.caller_number,
        cs.started_at::text,
        cs.answered_at::text,
        cs.ended_at::text,
        cs.status,
        cs.intent_type,
        cs.handoff_required,
        cs.handoff_target,
        cs.handoff_reason,
        cs.customer_id::text,
        cs.transcript_summary,
        mc.customer_code,
        mc.customer_name
      from aicc.call_session cs
      left join aicc.master_customer mc on mc.id = cs.customer_id
      where cs.id = $1
      limit 1
    `,
    [callSessionId]
  );

  const session = result.rows[0];

  if (!session) {
    throw createHttpError(404, 'Call session not found');
  }

  return session;
}

function mapSessionRow(
  app: Parameters<FastifyPluginAsync>[0],
  row: SessionListRow
) {
  return {
    id: row.id,
    providerCallId: row.provider_call_id,
    callerNumber: row.caller_number,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    status: row.status,
    intentType: row.intent_type,
    handoffRequired: row.handoff_required,
    handoffTarget: row.handoff_target,
    handoffReason: row.handoff_reason,
    customer: row.customer_id
      ? {
          id: row.customer_id,
          customerCode: row.customer_code,
          customerName: row.customer_name
        }
      : null,
    bridgeActive: app.callControlRegistry.has(row.id)
  };
}

async function ensureSessionExists(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string
) {
  await loadSession(app, callSessionId);
}

async function ensureDraftBelongsToCall(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  draftId: string
) {
  const result = await app.db.query(
    `
      select 1
      from aicc.order_draft
      where id = $1 and call_session_id = $2
      limit 1
    `,
    [draftId, callSessionId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Order draft not found for this call');
  }
}

async function ensureNotificationBelongsToCall(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  notificationId: string
) {
  const result = await app.db.query(
    `
      select 1
      from aicc.notification_delivery
      where id = $1 and call_session_id = $2
      limit 1
    `,
    [notificationId, callSessionId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Notification not found for this call');
  }
}

async function appendManagerEvent(
  app: Parameters<FastifyPluginAsync>[0],
  callSessionId: string,
  eventType: 'human_note' | 'handoff',
  content: string,
  metadata: Record<string, unknown>
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
      values ($1, $2::aicc.call_event_t, 'manager', $3, $4)
    `,
    [callSessionId, eventType, content, JSON.stringify(metadata)]
  );
}

function authorizeAdmin(request: FastifyRequest) {
  if (!env.ADMIN_API_TOKEN) {
    return;
  }

  const headerToken =
    typeof request.headers['x-admin-token'] === 'string'
      ? request.headers['x-admin-token']
      : null;
  const authorization =
    typeof request.headers.authorization === 'string'
      ? request.headers.authorization
      : null;
  const bearerToken =
    authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;

  if (headerToken === env.ADMIN_API_TOKEN || bearerToken === env.ADMIN_API_TOKEN) {
    return;
  }

  throw createHttpError(401, 'Unauthorized admin token');
}

export default adminRoutes;
