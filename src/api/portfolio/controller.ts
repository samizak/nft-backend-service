import { FastifyRequest, FastifyReply } from 'fastify';
import { ethers } from 'ethers';
import redisClient from '../../lib/redis';
import { CachedPortfolioResponse, PortfolioSummaryData } from './types';
import { addPortfolioJob } from '../../services/portfolioCalculatorService';

// Define cache constants
const CACHE_PREFIX_PORTFOLIO = 'portfolio:summary:';
// TTL is mainly managed by the worker writing the data,
// but we might use a short read TTL if needed later.

interface PortfolioParams {
  address: string;
}

export async function getPortfolioSummaryController(
  request: FastifyRequest<{ Params: PortfolioParams }>,
  reply: FastifyReply
): Promise<CachedPortfolioResponse> {
  // Return type hint

  const { address } = request.params;

  if (!ethers.isAddress(address)) {
    return reply.code(400).send({
      status: 'error',
      data: null,
      message: 'Invalid Ethereum address format.',
    });
  }
  const normalizedAddress = address.toLowerCase();
  const cacheKey = `${CACHE_PREFIX_PORTFOLIO}${normalizedAddress}`;

  try {
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      request.log.info(`[Portfolio API Cache HIT] for address: ${address}`);
      try {
        const parsedData: PortfolioSummaryData = JSON.parse(cachedData);
        // Optional: Add validation for parsedData structure here if needed
        return reply.send({ status: 'ready', data: parsedData });
      } catch (parseError) {
        request.log.error(
          `[Portfolio API Cache WARN] Failed to parse cached data for ${address}:`,
          parseError
        );
        // Proceed as if cache miss, potentially trigger calculation
      }
    }

    // --- Cache Miss ---
    request.log.info(`[Portfolio API Cache MISS] for address: ${address}`);

    // TODO: Check if a calculation job for this address is already pending/active in BullMQ
    // to avoid queueing duplicates frequently.

    // Trigger the background job (fire and forget, don't wait for it)
    try {
      await addPortfolioJob({ address: normalizedAddress });
      request.log.info(
        `[Portfolio API] Triggered background calculation job for: ${address}`
      );
    } catch (queueError) {
      request.log.error(
        `[Portfolio API Queue Error] Failed to add job for ${address}:`,
        queueError
      );
      // Even if queuing fails, we still return 'calculating' status,
      // maybe the job will be triggered by another mechanism later.
    }

    // Return "calculating" status to the frontend
    return reply.code(202).send({
      // 202 Accepted status code is suitable
      status: 'calculating',
      data: null,
      message: 'Portfolio summary calculation has been initiated.',
    });
  } catch (error) {
    request.log.error(
      `[Portfolio API Error] Error retrieving cached summary for ${address}:`,
      error
    );
    return reply.code(500).send({
      status: 'error',
      data: null,
      message: 'Internal Server Error retrieving portfolio summary.',
    });
  }
}
