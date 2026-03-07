import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { env } from './config/env';
import adminRoutes from './modules/admin/routes';
import callRoutes from './modules/calls/routes';
import customerRoutes from './modules/customers/routes';
import erpRoutes from './modules/erp/routes';
import healthRoutes from './modules/health/routes';
import metaRoutes from './modules/meta/routes';
import notificationsRoutes from './modules/notifications/routes';
import orchestratorRoutes from './modules/orchestrator/routes';
import orderRoutes from './modules/orders/routes';
import productRoutes from './modules/products/routes';
import realtimeRoutes from './modules/realtime/routes';
import techRoutes from './modules/tech/routes';
import twilioRoutes from './modules/twilio/routes';
import uiRoutes from './modules/ui/routes';
import workflowRoutes from './modules/workflows/routes';
import callControlPlugin from './plugins/call-control';
import dbPlugin from './plugins/db';
import ecountPlugin from './plugins/ecount';
import realtimePlugin from './plugins/realtime';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL
    }
  });

  await app.register(cors, {
    origin: true
  });

  await app.register(formbody);
  await app.register(websocket);
  await app.register(dbPlugin);
  await app.register(ecountPlugin);
  await app.register(realtimePlugin);
  await app.register(callControlPlugin);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: 'Invalid request',
        issues: error.flatten()
      });
    }

    request.log.error({ err: error }, 'request failed');

    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : null;

    if (statusCode !== null) {
      return reply.status(statusCode).send({
        message: error instanceof Error ? error.message : 'Request failed'
      });
    }

    return reply.status(500).send({
      message: 'Internal server error'
    });
  });

  app.register(healthRoutes);
  app.register(uiRoutes);
  app.register(adminRoutes, { prefix: '/api/v1/admin' });
  app.register(erpRoutes, { prefix: '/api/v1/erp' });
  app.register(metaRoutes, { prefix: '/api/v1/meta' });
  app.register(notificationsRoutes, { prefix: '/api/v1/notifications' });
  app.register(customerRoutes, { prefix: '/api/v1/customers' });
  app.register(productRoutes, { prefix: '/api/v1/products' });
  app.register(techRoutes, { prefix: '/api/v1/tech' });
  app.register(orchestratorRoutes, { prefix: '/api/v1/orchestrator' });
  app.register(realtimeRoutes, { prefix: '/api/v1/realtime' });
  app.register(twilioRoutes, { prefix: '/api/v1/twilio' });
  app.register(workflowRoutes, { prefix: '/api/v1/workflows' });
  app.register(callRoutes, { prefix: '/api/v1/calls' });
  app.register(orderRoutes, { prefix: '/api/v1/orders' });

  return app;
}
