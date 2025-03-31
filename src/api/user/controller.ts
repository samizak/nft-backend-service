import { FastifyRequest, FastifyReply } from 'fastify';
import { getUserProfileFromOpenSea } from './service';

interface GetUserProfileParams {
  id: string;
}

export const getUserProfile = async (
  request: FastifyRequest<{ Params: GetUserProfileParams }>,
  reply: FastifyReply
) => {
  const params = request.params;
  const { id } = params;

  if (!id) {
    return reply
      .code(400)
      .send({ error: 'Missing Ethereum address ID in URL path.' });
  }

  try {
    const userProfile = await getUserProfileFromOpenSea(id);
    reply.code(200).send(userProfile);
  } catch (error) {
    request.log.error({ err: error, userId: id }, 'Failed to get user profile');

    if (error instanceof Error && error.message.startsWith('UserNotFound:')) {
      return reply.code(404).send({ error: error.message });
    }
    if (
      error instanceof Error &&
      error.message.startsWith('Server configuration error:')
    ) {
      return reply
        .code(500)
        .send({ error: 'Internal server configuration error.' });
    }

    reply.code(500).send({ error: 'An internal server error occurred.' });
  }
};
