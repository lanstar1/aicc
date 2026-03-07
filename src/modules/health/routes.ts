import type { FastifyPluginAsync } from 'fastify';

import { env } from '../../config/env';

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'lanstar-aicc-api',
    now: new Date().toISOString()
  }));

  app.get('/health/details', async (_request, reply) => {
    const startedAt = Date.now();

    try {
      await app.db.query('select 1');
    } catch (error) {
      return reply.status(503).send({
        status: 'degraded',
        service: 'lanstar-aicc-api',
        now: new Date().toISOString(),
        db: {
          ok: false,
          error: error instanceof Error ? error.message : 'Database check failed'
        }
      });
    }

    return {
      status: 'ok',
      service: 'lanstar-aicc-api',
      now: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      environment: env.NODE_ENV,
      db: {
        ok: true,
        latencyMs: Date.now() - startedAt
      },
      realtime: {
        runtimeCount: app.realtimeHub.listSnapshots().length,
        bridgeCount: app.callControlRegistry.listSessionIds().length
      },
      integrations: {
        ecountConfigured: Boolean(
          env.ERP_BASE_URL && env.ERP_COM_CODE && env.ERP_USER_ID && env.ERP_API_CERT_KEY
        ),
        openaiConfigured: Boolean(env.OPENAI_API_KEY),
        twilioStreamingConfigured: Boolean(env.PUBLIC_BASE_URL),
        notificationMockMode: env.NOTIFICATION_MOCK_MODE,
        smsProvider: env.SMS_PROVIDER
      }
    };
  });

  app.get('/ready', async (_request, reply) => {
    try {
      await app.db.query('select 1');

      return {
        status: 'ready'
      };
    } catch (error) {
      return reply.status(503).send({
        status: 'not_ready',
        message: error instanceof Error ? error.message : 'Database check failed'
      });
    }
  });
};

export default healthRoutes;
