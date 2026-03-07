import fp from 'fastify-plugin';

import { RealtimeHub } from '../modules/realtime/hub';

export default fp(async (app) => {
  app.decorate('realtimeHub', new RealtimeHub());
});
