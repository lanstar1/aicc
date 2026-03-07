import type { FastifyInstance } from 'fastify';

import { generateCallSummary } from './summary-service';

type FinalizeCallSessionInput = {
  callSessionId: string;
  status?: 'live' | 'handoff' | 'completed' | 'failed';
  handoffRequired?: boolean;
  handoffTarget?: 'sales' | 'tech' | 'none';
  handoffReason?: string | null;
  transcriptFull?: string | null;
  transcriptSummary?: Record<string, unknown>;
};

type CurrentSessionRow = {
  status: 'ringing' | 'live' | 'handoff' | 'completed' | 'failed';
  handoff_required: boolean;
  handoff_target: 'sales' | 'tech' | 'none';
  handoff_reason: string | null;
};

export async function finalizeCallSession(
  app: FastifyInstance,
  input: FinalizeCallSessionInput
) {
  const current = await loadCurrentSession(app, input.callSessionId);
  const handoffRequired = input.handoffRequired ?? current.handoff_required;
  const handoffTarget = input.handoffTarget ?? current.handoff_target;
  const handoffReason =
    input.handoffReason !== undefined ? input.handoffReason : current.handoff_reason;
  const status = input.status ?? (handoffRequired ? 'handoff' : 'completed');

  const result = await app.db.query(
    `
      update aicc.call_session
      set
        status = $2::aicc.call_status_t,
        handoff_required = $3,
        handoff_target = $4::aicc.handoff_target_t,
        handoff_reason = $5,
        transcript_full = coalesce($6, transcript_full),
        transcript_summary = coalesce(transcript_summary, '{}'::jsonb) || $7::jsonb,
        ended_at = case
          when $2::aicc.call_status_t in ('handoff', 'completed', 'failed') then coalesce(ended_at, now())
          else ended_at
        end
      where id = $1
      returning *
    `,
    [
      input.callSessionId,
      status,
      handoffRequired,
      handoffTarget,
      handoffReason ?? null,
      input.transcriptFull ?? null,
      JSON.stringify(input.transcriptSummary ?? {})
    ]
  );

  await generateCallSummary(app, input.callSessionId, {
    force: true
  });

  return result.rows[0] ?? null;
}

async function loadCurrentSession(app: FastifyInstance, callSessionId: string) {
  const result = await app.db.query<CurrentSessionRow>(
    `
      select status, handoff_required, handoff_target, handoff_reason
      from aicc.call_session
      where id = $1
      limit 1
    `,
    [callSessionId]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error('Call session not found');
  }

  return row;
}
