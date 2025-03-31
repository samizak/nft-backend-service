import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { getUserProfile } from './controller';

const profileParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

async function userRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  fastify.get(
    '/profile/:id',
    {
      schema: {
        params: profileParamsSchema,
        // Add response schemas here for different status codes if desired
        // response: {
        //   200: { ... schema for success ... },
        //   404: { ... schema for not found ... },
        // }
      },
    },
    getUserProfile
  );
}

export default userRoutes;
