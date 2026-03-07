import fp from 'fastify-plugin';

import { CallControlRegistry } from '../modules/control/registry';

export default fp(async (app) => {
  app.decorate('callControlRegistry', new CallControlRegistry());
});
