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
    const jobId = normalizedAddress;
    const existingJob = await getPortfolioJob(jobId);
    let jobState: string | undefined;
    let progressData: any = null;

    if (existingJob) {
      jobState = await existingJob.getState();
      progressData = existingJob.progress;
      request.log.info(
        `[Portfolio API] Found existing job ${jobId} in state: ${jobState}, progress: ${JSON.stringify(progressData)}`
      );

      if (['active', 'waiting', 'delayed'].includes(jobState)) {
        request.log.info(
          `[Portfolio API] Job ${jobId} is active/pending. Returning status: calculating with progress.`
        );
        return reply.code(202).send({
          status: 'calculating',
          data: null,
          message:
            progressData?.message ||
            'Portfolio summary calculation is in progress.',
          progress: progressData,
        });
      }
      request.log.info(
        `[Portfolio API] Job ${jobId} found in state ${jobState}. Cache miss persists. Will attempt to re-queue.`
      );
    }

    // 3. No Active Job Found or Job Completed/Failed: Trigger New Calculation
    request.log.info(
      `[Portfolio API] No active job found or cache miss persists for ${address}. Triggering calculation.`
    );

    try {
      const addedJob = await addPortfolioJob({ address: normalizedAddress });
      if (addedJob) {
        request.log.info(
          `[Portfolio API] Triggered/confirmed background job for: ${address} (Job ID: ${addedJob.id})`
        );
        progressData = addedJob.progress;
      } else {
        request.log.warn(
          `[Portfolio API] Failed to trigger background job for: ${address}. Queue might be unavailable.`
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
        `[Portfolio API Queue Error] Error interacting with queue for ${address}:`,
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
      message:
        progressData?.message ||
        'Portfolio summary calculation has been initiated.',
      progress: progressData,
    });
  } catch (error) {
    request.log.error(
      `[Portfolio API Error] Unexpected error in controller for ${address}:`,
      error
    );
    return reply.code(500).send({
      status: 'error',
      data: null,
      message: 'Internal Server Error processing portfolio request.',
    });
  }
}
