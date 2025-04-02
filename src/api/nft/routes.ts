import { FastifyInstance } from 'fastify';
import { getNftsByAccountHandler, getNftsByAccountSchema } from './controller';

async function nftRoutes(fastify: FastifyInstance) {
  // GET /nft/by-account?address=0x...&next=...&maxPages=...
  fastify.get(
    '/by-account',
    {
      schema: getNftsByAccountSchema,
    },
    getNftsByAccountHandler
  );
}

export default nftRoutes;
