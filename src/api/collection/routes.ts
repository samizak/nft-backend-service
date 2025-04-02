import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  getBatchCollections,
  getNFTGOCollectionInfoHandler,
  getNFTGOCollectionInfoSchema,
  getNFTGOFloorPriceHandler,
  getNFTGOFloorPriceSchema,
} from './controller';
import {
  getBatchCollectionDataFromCache,
  clearCollectionCache,
} from './service';

async function collectionRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // POST /collection/batch-collections
  fastify.post(
    '/batch-collections',
    {
      schema: {
        body: {
          type: 'object',
          required: ['collection_slugs'],
          properties: {
            collection_slugs: {
              type: 'array',
              items: {
                type: 'string',
              },
              minItems: 1,
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
    getBatchCollections
  );

  // POST /collection/nftgo-info
  fastify.post(
    '/nftgo-info',
    {
      schema: getNFTGOCollectionInfoSchema,
    },
    getNFTGOCollectionInfoHandler
  );

  // GET /collection/nftgo-floor-price/:contract_address
  fastify.get(
    '/nftgo-floor-price/:contract_address',
    {
      schema: getNFTGOFloorPriceSchema,
    },
    getNFTGOFloorPriceHandler
  );

  fastify.post<{ Body: { slugs: string[] } }>(
    '/clear-cache',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            slugs: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['slugs'],
        },
      },
    },
    async (request, reply) => {
      try {
        const { slugs } = request.body;
        await clearCollectionCache(slugs);
        return reply.send({
          success: true,
          message: 'Cache cleared successfully',
        });
      } catch (error) {
        request.log.error('Error clearing cache:', error);
        return reply.code(500).send({ error: 'Failed to clear cache' });
      }
    }
  );
}

export default collectionRoutes;
