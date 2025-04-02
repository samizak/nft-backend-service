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
) {
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
  request.log.info(`[Portfolio API] Checking cache for key: ${cacheKey}`);

  try {
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      request.log.info(
        `[Portfolio API Cache HIT] Found raw data for address: ${address}`
      );
      try {
        const parsedData: PortfolioSummaryData = JSON.parse(cachedData);
        // Log the parsed data before sending
        request.log.info({
          msg: `[Portfolio API Cache HIT] Parsed data successfully for ${address}. Returning status: ready.`,
          address: address,
          // Only log key summary fields, not the full breakdown array
          summary: {
            totalValueEth: parsedData.totalValueEth,
            nftCount: parsedData.nftCount,
            calculatedAt: parsedData.calculatedAt,
          },
        });
        return reply.send({ status: 'ready', data: parsedData });
      } catch (parseError) {
        request.log.error(
          `[Portfolio API Cache WARN] Failed to parse cached data for ${address}. Data was: ${cachedData}`,
          parseError
        );
        // Proceed as if cache miss if parsing fails
      }
    } else {
      // Logged miss correctly now
      request.log.info(
        `[Portfolio API Cache MISS] No data found in Redis for key: ${cacheKey}`
      );
    }

    // --- Cache Miss or Parse Failure Logic ---
    request.log.info(
      `[Portfolio API] Cache miss or parse failure for ${address}. Triggering calculation.`
    );

    // TODO: Check if a calculation job for this address is already pending/active in BullMQ

    // Trigger the background job
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
    }

    // Return "calculating" status
    return reply.code(202).send({
      // 202 Accepted
      status: 'calculating',
      data: null,
      message: 'Portfolio summary calculation has been initiated.',
    });
  } catch (error) {
    request.log.error(
      `[Portfolio API Error] Error retrieving cached summary for ${address}:`,
      error
    );
    // Ensure error response is sent
    return reply.code(500).send({
      status: 'error',
      data: null,
      message: 'Internal Server Error retrieving portfolio summary.',
    });
  }
}
