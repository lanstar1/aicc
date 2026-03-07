import { Pool } from 'pg';

import { env } from '../config/env';

type PurgeStats = {
  expiredSessionCount: number;
  transcriptPurgedCount: number;
  callEventDeletedCount: number;
  notificationRedactedCount: number;
};

async function main() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined
  });

  const dryRun = process.argv.includes('--dry-run');
  const client = await pool.connect();

  try {
    await client.query('begin');

    const expiredResult = await client.query<{ count: string }>(
      `
        select count(*)::text as count
        from aicc.call_session
        where retention_until < now()
      `
    );

    const transcriptResult = await client.query<{ count: string }>(
      `
        with updated as (
          update aicc.call_session
          set
            transcript_full = null,
            transcript_summary = jsonb_build_object(
              'purged', true,
              'purgedAt', now()::text
            )
          where
            retention_until < now()
            and (
              transcript_full is not null
              or coalesce(transcript_summary->>'purged', 'false') <> 'true'
            )
          returning id
        )
        select count(*)::text as count
        from updated
      `
    );

    const eventResult = await client.query<{ count: string }>(
      `
        with deleted as (
          delete from aicc.call_event ce
          using aicc.call_session cs
          where
            ce.call_session_id = cs.id
            and cs.retention_until < now()
          returning ce.id
        )
        select count(*)::text as count
        from deleted
      `
    );

    const notificationResult = await client.query<{ count: string }>(
      `
        with updated as (
          update aicc.notification_delivery nd
          set
            subject = case when nd.subject is null then null else '[expired]' end,
            body = '[expired]',
            metadata = coalesce(nd.metadata, '{}'::jsonb) || jsonb_build_object(
              'retentionPurged', true,
              'retentionPurgedAt', now()::text
            )
          from aicc.call_session cs
          where
            nd.call_session_id = cs.id
            and cs.retention_until < now()
            and (
              nd.body <> '[expired]'
              or coalesce(nd.metadata->>'retentionPurged', 'false') <> 'true'
            )
          returning nd.id
        )
        select count(*)::text as count
        from updated
      `
    );

    const stats: PurgeStats = {
      expiredSessionCount: Number(expiredResult.rows[0]?.count ?? 0),
      transcriptPurgedCount: Number(transcriptResult.rows[0]?.count ?? 0),
      callEventDeletedCount: Number(eventResult.rows[0]?.count ?? 0),
      notificationRedactedCount: Number(notificationResult.rows[0]?.count ?? 0)
    };

    if (dryRun) {
      await client.query('rollback');
      printResult({ ...stats, dryRun: true });
      return;
    }

    await client.query('commit');
    printResult({ ...stats, dryRun: false });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function printResult(result: PurgeStats & { dryRun: boolean }) {
  console.log(
    JSON.stringify(
      {
        command: 'purge-retention',
        ...result
      },
      null,
      2
    )
  );
}

void main();
