import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyPluginAsync } from 'fastify';

const uiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/admin-console', async (_request, reply) => {
    const filePath = path.join(process.cwd(), 'public', 'admin-console.html');
    const html = await readFile(filePath, 'utf8');

    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(html);
  });
};

export default uiRoutes;
