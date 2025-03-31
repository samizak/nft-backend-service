import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolveEnsName } from '../../services/ensService';

// Define the expected parameters type
interface EnsParams {
  name: string;
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    '/resolve/:name',
    async (
      request: FastifyRequest<{ Params: EnsParams }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;

      if (!name) {
        return reply
          .code(400)
          .send({ error: 'ENS name parameter is required' });
      }

      try {
        const address = await resolveEnsName(name);
        if (address) {
          return reply.send({ ensName: name, address });
        } else {
          return reply
            .code(404)
            .send({ error: `Could not resolve ENS name: ${name}` });
        }
      } catch (error) {
        fastify.log.error(`Error processing ENS request for ${name}:`, error);
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  );
}
