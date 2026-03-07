import fp from 'fastify-plugin';
import { Pool } from 'pg';

import { env } from '../config/env';

export default fp(async (app) => {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined
  });

  app.decorate('db', pool);

  app.addHook('onClose', async () => {
    await pool.end();
  });
});

