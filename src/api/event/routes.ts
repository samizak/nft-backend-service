import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  getEventsByAccountHandler,
  getEventsByAccountSchema,
} from './controller';

async function eventRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // GET /event/by-account?address=0x...&maxPages=...
  fastify.get(
    '/by-account',
    {
      schema: getEventsByAccountSchema,
    },
    getEventsByAccountHandler
  );
}

export default eventRoutes;
