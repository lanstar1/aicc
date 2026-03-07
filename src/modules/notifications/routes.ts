import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env';
import { createHttpError } from '../../lib/http';
import {
  listNotifications,
  queueNotification,
  queueOrderDraftSummary,
  sendNotificationById,
  type NotificationChannel
} from './service';

const listNotificationsQuerySchema = z.object({
  status: z.enum(['queued', 'sent', 'failed']).optional(),
  channel: z.enum(['email', 'sms', 'alimtalk']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const createNotificationBodySchema = z.object({
  callSessionId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  channel: z.enum(['email', 'sms', 'alimtalk']),
  recipient: z.string().trim().min(1),
  subject: z.string().trim().optional(),
  body: z.string().trim().min(1),
  sendNow: z.boolean().default(false),
  metadata: z.record(z.any()).default({})
});

const queueOrderSummaryBodySchema = z.object({
  channel: z.enum(['email', 'sms', 'alimtalk']),
  recipient: z.string().trim().min(1),
  callSessionId: z.string().uuid().optional(),
  sendNow: z.boolean().default(true)
});

const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    authorizeNotificationApi(request);
  });

  app.get('/', async (request) => {
    const query = listNotificationsQuerySchema.parse(request.query);
    const input: Parameters<typeof listNotifications>[1] = {
      limit: query.limit
    };

    if (query.status) {
      input.status = query.status;
    }

    if (query.channel) {
      input.channel = query.channel;
    }

    return {
      items: await listNotifications(app, input)
    };
  });

  app.post('/', async (request, reply) => {
    const body = createNotificationBodySchema.parse(request.body);
    const input: Parameters<typeof queueNotification>[1] = {
      channel: body.channel as NotificationChannel,
      recipient: body.recipient,
      body: body.body,
      metadata: body.metadata
    };

    if (body.callSessionId) {
      input.callSessionId = body.callSessionId;
    }

    if (body.customerId) {
      input.customerId = body.customerId;
    }

    if (body.subject) {
      input.subject = body.subject;
    }

    const queued = await queueNotification(app, input);

    if (!body.sendNow) {
      return reply.status(201).send({
        queued,
        sent: null
      });
    }

    const sent = await sendNotificationById(app, queued.id);

    return reply.status(201).send({
      queued,
      sent
    });
  });

  app.post('/:id/send', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    return sendNotificationById(app, params.id);
  });

  app.post('/order-drafts/:id/summary', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = queueOrderSummaryBodySchema.parse(request.body);
    const input: Parameters<typeof queueOrderDraftSummary>[1] = {
      draftId: params.id,
      channel: body.channel,
      recipient: body.recipient,
      sendNow: body.sendNow
    };

    if (body.callSessionId) {
      input.callSessionId = body.callSessionId;
    }

    const result = await queueOrderDraftSummary(app, input);

    return reply.status(201).send(result);
  });
};

function authorizeNotificationApi(request: FastifyRequest) {
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

export default notificationsRoutes;
