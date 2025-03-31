import { FastifyRequest, FastifyReply } from 'fastify';
import { fetchBatchCollectionData } from './service';
import { BatchCollectionsRequestBody } from './types';

export async function getBatchCollections(
  request: FastifyRequest<{
    Body: BatchCollectionsRequestBody;
  }>,
  reply: FastifyReply
) {
  try {
    const { collections } = request.body;

    if (!collections || !Array.isArray(collections)) {
      return reply.code(400).send({
        error: 'Invalid request format. Expected array of collection slugs',
      });
    }

    if (collections.length === 0) {
      return reply.code(400).send({
        error: 'Collections array cannot be empty',
      });
    }

    const MAX_COLLECTIONS = 50;
    if (collections.length > MAX_COLLECTIONS) {
      return reply.code(400).send({
        error: `Too many collections requested. Maximum is ${MAX_COLLECTIONS}`,
      });
    }

    const result = await fetchBatchCollectionData(collections);
    return reply.send(result);
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: 'Internal server error',
    });
  }
}
