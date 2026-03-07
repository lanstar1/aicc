import 'fastify';
import type { Pool } from 'pg';
import type { CallControlRegistry } from '../modules/control/registry';
import type { EcountClient } from '../integrations/ecount/client';
import type { RealtimeHub } from '../modules/realtime/hub';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
    ecount: EcountClient;
    realtimeHub: RealtimeHub;
    callControlRegistry: CallControlRegistry;
  }
}
