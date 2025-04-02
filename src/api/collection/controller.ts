import { FastifyRequest, FastifyReply } from 'fastify';
import { getBatchCollectionDataFromCache } from './service';
import { BatchCollectionsRequestBody } from './types';

export async function getBatchCollections(
  request: FastifyRequest<{
    Body: BatchCollectionsRequestBody;
  }>,
  reply: FastifyReply
) {
  try {
    const { collection_slugs } = request.body;

    if (!collection_slugs || !Array.isArray(collection_slugs)) {
      return reply.code(400).send({
        error: 'Invalid request body. Expected { collection_slugs: string[] }.',
      });
    }

    if (collection_slugs.length === 0) {
      return reply.code(400).send({
        error: 'collection_slugs array cannot be empty',
      });
    }

    const MAX_SLUGS_PER_REQUEST = 100;
    if (collection_slugs.length > MAX_SLUGS_PER_REQUEST) {
      return reply.code(400).send({
        error: `Too many slugs requested. Maximum allowed per request is ${MAX_SLUGS_PER_REQUEST}`,
      });
    }

    const result = await getBatchCollectionDataFromCache(collection_slugs);
    return reply.send(result);
  } catch (error) {
    request.log.error('Error in getBatchCollections controller:', error);
    return reply.code(500).send({
      error: 'Internal Server Error fetching batch collection data',
    });
  }
}
