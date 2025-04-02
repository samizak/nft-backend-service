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
};

export default collectionRoutes;
