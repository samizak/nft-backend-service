import { FastifyInstance } from 'fastify';
import { getPortfolioSummaryController } from './controller';

// Define schema for the address parameter
const addressParamSchema = {
  type: 'object',
  properties: {
    address: { type: 'string' },
  },
  required: ['address'],
};

// Optional: Define a more specific response schema if needed

export default async function (fastify: FastifyInstance) {
  fastify.get(
    '/summary/:address',
    {
      schema: {
        params: addressParamSchema,
        // response: { ... } // Add response schema later if desired
      },
    },
    getPortfolioSummaryController
  );
}
