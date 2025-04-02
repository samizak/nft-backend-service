import { FastifyRequest, FastifyReply } from 'fastify';
import { getNftsByAccount } from './service';

interface GetNftsByAccountQuery {
  address: string;
  cursor?: string;
}

export const getNftsByAccountSchema = {
  querystring: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
      },
      cursor: { type: 'string' },
    },
    required: ['address'],
  },
};

export const getNftsByAccountHandler = async (
  request: FastifyRequest<{ Querystring: GetNftsByAccountQuery }>,
  reply: FastifyReply
) => {
  const { address, cursor } = request.query;

  try {
    const result = await getNftsByAccount(address, cursor || null);
    reply.code(200).send(result);
  } catch (error) {
    request.log.error(
      { err: error, query: request.query },
      'Failed to get NFTs by account'
    );

    if (error instanceof Error) {
      if (error.message.startsWith('Server configuration error:')) {
        return reply
          .code(500)
          .send({ error: 'Internal server configuration error.' });
      }
      if (error.message.startsWith('Invalid request for address')) {
        return reply.code(400).send({
          error: 'Bad Request: Invalid address format or related issue.',
          details: error.message,
        });
      }
      if (
        error.message.includes('Failed to fetch NFTs from OpenSea: Status 429')
      ) {
        return reply
          .code(429)
          .send({ error: 'Rate limit exceeded when contacting OpenSea.' });
      }
    }

    reply.code(500).send({
      error: 'An internal server error occurred while fetching NFTs.',
    });
  }
};
