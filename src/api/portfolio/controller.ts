import { FastifyRequest, FastifyReply } from 'fastify';
import { ethers } from 'ethers';
import redisClient from '../../lib/redis';
import { PortfolioSummaryData } from './types';
import {
  addPortfolioJob,
  getPortfolioJob,
} from '../../services/portfolioCalculatorService';

// Define cache constants
const CACHE_PREFIX_PORTFOLIO = 'portfolio:summary:';
// TTL is mainly managed by the worker writing the data,
// but we might use a short read TTL if needed later.

interface PortfolioParams {
  address: string;
}

// Define a simple initial progress structure
const initialProgress = {
  step: 'Queued',
  message: 'Calculation queued...',
};

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
    // 1. Check Cache First
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
    }

    // Log cache miss
    request.log.info(
      `[Portfolio API Cache MISS] No data found in Redis for key: ${cacheKey}`
    );

    // 2. Cache Miss: Check for Existing Job & Get Progress
    const jobInfo = await getPortfolioJob(normalizedAddress);

    if (
      jobInfo &&
      (jobInfo.status === 'active' ||
        jobInfo.status === 'waiting' ||
        jobInfo.status === 'delayed')
    ) {
      // Job is running or queued - return 202 with LIVE progress
      request.log.info(
        `[Portfolio API] Job found for ${normalizedAddress}. Status: ${jobInfo.status}, Progress:`,
        jobInfo.progress
      );
      return reply.code(202).send({
        status: 'calculating',
        data: null,
        message: `Portfolio summary calculation is ${jobInfo.status}.`,
        progress: jobInfo.progress || initialProgress, // Send actual progress, or initial if null
      });
    }

    // 3. No Active Job Found or Job Completed/Failed: Trigger New Calculation
    request.log.info(
      `[Portfolio API] No active job found or cache miss persists for ${normalizedAddress}. Triggering calculation.`
    );

    try {
      const addedJob = await addPortfolioJob({ address: normalizedAddress });
      if (addedJob) {
        request.log.info(
          `[Portfolio API] Triggered/confirmed background job for: ${normalizedAddress} (Job ID: ${addedJob.id})`
        );
      } else {
        request.log.warn(
          `[Portfolio API] Failed to trigger background job for: ${normalizedAddress}. Queue might be unavailable.`
        );
        return reply.code(503).send({
          status: 'error',
          data: null,
          message:
            'Calculation service is currently unavailable. Please try again later.',
        });
      }
    } catch (queueError) {
      request.log.error(
        `[Portfolio API Queue Error] Error interacting with queue for ${normalizedAddress}:`,
        queueError
      );
      return reply.code(500).send({
        status: 'error',
        data: null,
        message: 'Error initiating portfolio calculation.',
      });
    }

    // Return initial "calculating" status after triggering
    return reply.code(202).send({
      status: 'calculating',
      data: null,
      message: 'Portfolio summary calculation has been queued.',
      progress: initialProgress,
    });
  } catch (error) {
    request.log.error(
      `[Portfolio API Error] Unexpected error in controller for ${normalizedAddress}:`,
      error
    );
    return reply.code(500).send({
      status: 'error',
      data: null,
      message: 'Internal Server Error processing portfolio request.',
    });
  }
}
