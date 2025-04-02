import { FastifyRequest, FastifyReply } from 'fastify';
import redisClient from '../../lib/redis';

// Define the known cache prefixes
const CACHE_PREFIXES_TO_CLEAR = [
  'portfolio:summary:*', // Portfolio summaries
  'collection:*', // Collection data (from worker or API fetch)
  'ens:resolve:*', // ENS name resolves
  'ens:lookup:*', // ENS address lookups
  'nft_page:*', // NFT pagination results
  // Add any other relevant cache prefixes here
];

// Helper function to delete keys by pattern
async function deleteKeysByPattern(pattern: string): Promise<number> {
  let cursor = '0';
  let deletedCount = 0;
  do {
    const scanResult = await redisClient.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      100
    );
    cursor = scanResult[0];
    const keys = scanResult[1];
    if (keys.length > 0) {
      const pipeline = redisClient.pipeline();
      keys.forEach((key) => pipeline.del(key));
      const results = await pipeline.exec();
      // results is an array of [error, numberOfKeysDeleted] for each command
      results?.forEach((result) => {
        if (result && result[0] === null && typeof result[1] === 'number') {
          deletedCount += result[1];
        }
      });
    }
  } while (cursor !== '0');
  return deletedCount;
}

export async function clearAllCacheController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.warn(
    '[Admin Cache Clear] Received request to clear all known caches.'
  );
  let totalDeleted = 0;
  const results: Record<string, number | string> = {};

  try {
    for (const pattern of CACHE_PREFIXES_TO_CLEAR) {
      try {
        const count = await deleteKeysByPattern(pattern);
        results[pattern] = count;
        totalDeleted += count;
        request.log.info(
          `[Admin Cache Clear] Cleared ${count} keys for pattern: ${pattern}`
        );
      } catch (patternError) {
        request.log.error(
          `[Admin Cache Clear] Error clearing pattern ${pattern}:`,
          patternError
        );
        results[pattern] = 'Error';
      }
    }

    request.log.warn(
      `[Admin Cache Clear] Finished. Total keys deleted: ${totalDeleted}`
    );
    return reply.send({
      success: true,
      message: `Cache clear attempted. Total keys deleted: ${totalDeleted}`,
      details: results,
    });
  } catch (error) {
    request.log.error(
      '[Admin Cache Clear] General error during cache clear:',
      error
    );
    return reply.code(500).send({
      success: false,
      message: 'Internal Server Error during cache clear',
      details: results,
    });
  }
}
