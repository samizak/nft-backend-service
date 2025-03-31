import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getBatchCollections } from './controller';

const collectionRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  fastify.post(
    '/batch-collections',
    {
      schema: {
        body: {
          type: 'object',
          required: ['collections'],
          properties: {
            collections: {
              type: 'array',
              items: {
                type: 'string',
              },
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
};

export default collectionRoutes;
