import fp from 'fastify-plugin';

import { EcountClient } from '../integrations/ecount/client';

export default fp(async (app) => {
  app.decorate('ecount', new EcountClient());
});

