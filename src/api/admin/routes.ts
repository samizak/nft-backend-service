import { FastifyInstance } from 'fastify';
import { clearAllCacheController } from './controller';

// Optional: Add authentication/authorization middleware here later
// to protect this endpoint.

export default async function (fastify: FastifyInstance) {
  fastify.post(
    '/clear-all-cache',
    {
      // No schema needed for request body
      // Optional: Define response schema
    },
    clearAllCacheController
  );
}
