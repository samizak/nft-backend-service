import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { getAccountActivity } from './controller';

// Define schema for pagination query parameters
const getEventsQuerySchema = {
  type: 'object',
  properties: {
    page: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' }, // Positive integer
    limit: { type: 'string', pattern: '^[1-9]\\d*$', default: '50' }, // Positive integer
  },
};

// Define schema for address path parameter
const getEventsParamsSchema = {
  type: 'object',
  properties: {
    address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }, // Ethereum address pattern
  },
  required: ['address'],
};

async function eventRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // GET /event/by-account/:address - Returns paginated events as JSON
  fastify.get(
    '/by-account/:address',
    {
      schema: {
        params: getEventsParamsSchema,
        querystring: getEventsQuerySchema,
        // TODO: Add response schema for better validation/documentation
      },
    },
    getAccountActivity // Use the correct controller handler
  );
}

export default eventRoutes;
