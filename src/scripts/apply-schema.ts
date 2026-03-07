import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Pool, type PoolClient } from 'pg';

import { env } from '../config/env';

const MIGRATION_NAME = '001_aicc_schema.sql';

async function main() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined
  });

  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);

    const applied = await client.query<{ exists: boolean }>(
      `
        select exists (
          select 1
          from aicc.schema_migration
          where migration_name = $1
        ) as exists
      `,
      [MIGRATION_NAME]
    );

    if (applied.rows[0]?.exists) {
      console.log(
        JSON.stringify(
          {
            command: 'db:apply-schema',
            status: 'skipped',
            migration: MIGRATION_NAME
          },
          null,
          2
        )
      );
      return;
    }

    const sqlPath = path.join(process.cwd(), 'sql', MIGRATION_NAME);
    const sql = await readFile(sqlPath, 'utf8');

    await client.query('begin');
    await client.query(sql);
    await client.query(
      `
        insert into aicc.schema_migration (migration_name)
        values ($1)
      `,
      [MIGRATION_NAME]
    );
    await client.query('commit');

    console.log(
      JSON.stringify(
        {
          command: 'db:apply-schema',
          status: 'applied',
          migration: MIGRATION_NAME
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function ensureMigrationTable(client: PoolClient) {
  await client.query(`
    create schema if not exists aicc;

    create table if not exists aicc.schema_migration (
      migration_name text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

void main();
