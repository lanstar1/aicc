import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { buildTechAnswerPreview, searchTechKnowledge } from './service';

const techSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5)
});

const techAnswerPreviewBodySchema = z.object({
  query: z.string().trim().min(1),
  modelName: z.string().trim().optional(),
  productName: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5)
});

const techRoutes: FastifyPluginAsync = async (app) => {
  app.get('/search', async (request) => {
    const query = techSearchQuerySchema.parse(request.query);

    return {
      items: await searchTechKnowledge(app, query.q, query.limit)
    };
  });

  app.post('/answer-preview', async (request) => {
    const body = techAnswerPreviewBodySchema.parse(request.body);
    const input: Parameters<typeof buildTechAnswerPreview>[1] = {
      query: body.query,
      limit: body.limit
    };

    if (body.modelName) {
      input.modelName = body.modelName;
    }

    if (body.productName) {
      input.productName = body.productName;
    }

    return buildTechAnswerPreview(app, input);
  });
};

export default techRoutes;
