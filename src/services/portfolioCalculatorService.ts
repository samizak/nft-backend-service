import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import pLimit from 'p-limit';
import dotenv from 'dotenv';

import redisClient from '../lib/redis';
import { env } from 'process';

// Import necessary functions and types
import {
  fetchCollectionData,
  CombinedCollectionData,
} from '../utils/collectionApi'; // Use the centralized fetcher & import CombinedCollectionData
import { getEthPrices } from './priceFetcher'; // To get current ETH price for USD conversion
import { getNftsByAccount } from '../api/nft/service'; // To fetch all NFTs
import {
  PortfolioSummaryData,
  PortfolioCollectionBreakdown,
} from '../api/portfolio/types'; // Types for the result

dotenv.config();

// --- Configuration & Constants ---
const QUEUE_NAME = 'portfolio-calculator-queue';
const CACHE_PREFIX = 'portfolio:summary:';
const CACHE_TTL_SECONDS = 60 * 15; // Cache portfolio summary for 15 minutes

const MAX_CONCURRENT_COLLECTION_FETCH = 10; // Concurrency for fetching collection data
const MAX_RETRIES_PER_JOB = 2; // Retries for the portfolio calculation job itself
const INITIAL_RETRY_DELAY_MS = 60 * 1000; // Retry job after 1 minute

// --- Job Data Interface ---
interface PortfolioJobData {
  address: string; // Lowercase address
}

// --- BullMQ Queue Definition ---
const portfolioQueue = new Queue<PortfolioJobData>(QUEUE_NAME, {
  connection: redisClient,
  defaultJobOptions: {
    attempts: MAX_RETRIES_PER_JOB + 1,
    backoff: {
      type: 'exponential',
      delay: INITIAL_RETRY_DELAY_MS,
    },
    removeOnComplete: { count: 500, age: 60 * 60 * 24 }, // Keep fewer completed jobs
    removeOnFail: { count: 1000, age: 60 * 60 * 24 * 7 },
  },
});

// --- BullMQ Worker Logic ---

// Helper to fetch ALL NFTs for an address, handling pagination
async function fetchAllNfts(address: string): Promise<any[]> {
  let allNfts: any[] = [];
  let nextCursor: string | null = null;
  let page = 1;
  const MAX_PAGES = 50; // Safety break to prevent infinite loops

  console.log(`[Portfolio Worker] Starting NFT fetch for ${address}`);
  do {
    try {
      console.log(
        `[Portfolio Worker] Fetching NFT page ${page} for ${address} (Cursor: ${nextCursor})`
      );
      const result = await getNftsByAccount(address, nextCursor);
      if (result && result.nfts) {
        allNfts = allNfts.concat(result.nfts);
      }
      nextCursor = result?.nextCursor ?? null;
      page++;
      // Optional: Add a small delay between pages if hitting rate limits
      // await new Promise(resolve => setTimeout(resolve, 250));
    } catch (error) {
      console.error(
        `[Portfolio Worker] Error fetching NFT page ${page} for ${address}:`,
        error
      );
      // Decide if we should stop or continue after an error on one page
      // For now, we stop to avoid calculating with incomplete data
      throw new Error(`Failed to fetch all NFTs for ${address}`);
    }
  } while (nextCursor && page <= MAX_PAGES);

  if (page > MAX_PAGES) {
    console.warn(
      `[Portfolio Worker] Reached MAX_PAGES limit (${MAX_PAGES}) for ${address}. NFT list may be incomplete.`
    );
  }
  console.log(
    `[Portfolio Worker] Fetched a total of ${allNfts.length} NFTs for ${address}`
  );
  return allNfts;
}

const worker = new Worker<PortfolioJobData>(
  QUEUE_NAME,
  async (job: Job<PortfolioJobData>) => {
    const { address } = job.data; // Address is already lowercase from controller
    console.log(
      `[Portfolio Worker] Starting calculation for address: ${address} (Job ID: ${job.id})`
    );

    try {
      // 1. Fetch all NFTs
      const allNfts = await fetchAllNfts(address);
      if (allNfts.length === 0) {
        console.log(
          `[Portfolio Worker] No NFTs found for ${address}. Storing empty summary.`
        );
        const emptySummary: PortfolioSummaryData = {
          totalValueEth: 0,
          totalValueUsd: 0,
          nftCount: 0,
          collectionCount: 0,
          breakdown: [],
          calculatedAt: new Date().toISOString(),
          ethPriceUsd: getEthPrices().usd ?? 0,
        };
        const cacheKey = `${CACHE_PREFIX}${address}`;
        await redisClient.set(
          cacheKey,
          JSON.stringify(emptySummary),
          'EX',
          CACHE_TTL_SECONDS
        );
        return; // Job done
      }

      // 2. Group NFTs by collection and get unique slugs/addresses
      const collectionsMap = new Map<
        string,
        { slug: string; contractAddress: string; nfts: any[] }
      >();
      allNfts.forEach((nft: any) => {
        if (nft.collection && nft.contract) {
          const key = nft.collection;
          if (!collectionsMap.has(key)) {
            collectionsMap.set(key, {
              slug: nft.collection,
              contractAddress: nft.contract,
              nfts: [],
            });
          }
          collectionsMap.get(key)?.nfts.push(nft);
        }
      });
      const uniqueCollections = Array.from(collectionsMap.values());
      console.log(
        `[Portfolio Worker] Found ${uniqueCollections.length} unique collections for ${address}.`
      );

      // 3. Fetch collection floor prices (using batch endpoint logic)
      const limit = pLimit(MAX_CONCURRENT_COLLECTION_FETCH);
      const collectionDataPromises = uniqueCollections.map((col) =>
        limit(() => fetchCollectionData(col.slug, col.contractAddress))
      );
      const collectionDataResults = await Promise.allSettled(
        collectionDataPromises
      );

      const collectionDataMap = new Map<string, CombinedCollectionData>();
      collectionDataResults.forEach((result, index) => {
        const slug = uniqueCollections[index].slug;
        if (result.status === 'fulfilled') {
          collectionDataMap.set(slug, result.value);
        } else {
          console.warn(
            `[Portfolio Worker] Failed to fetch collection data for ${slug}:`,
            result.reason
          );
          // Store a default structure so we know it failed? Or just skip?
          // Skipping for now - won't be included in value calculation
        }
      });
      console.log(
        `[Portfolio Worker] Fetched data for ${collectionDataMap.size} collections for ${address}.`
      );

      // 4. Get current ETH price
      const ethPrices = getEthPrices();
      const ethPriceUsd = ethPrices.usd; // May be undefined

      // 5. Calculate breakdown and totals
      let totalValueEth = 0;
      let totalNftCount = 0;
      const breakdown: PortfolioCollectionBreakdown[] = [];

      collectionsMap.forEach((colInfo, slug) => {
        const collectionData = collectionDataMap.get(slug);
        const floorPriceEth = collectionData?.floor_price ?? 0;
        const nftCount = colInfo.nfts.length;
        const collectionValueEth = floorPriceEth * nftCount;

        totalValueEth += collectionValueEth;
        totalNftCount += nftCount;

        // Only include in breakdown if value > 0 or collection data exists?
        if (collectionData) {
          // Only include collections we got data for
          const breakdownItem: PortfolioCollectionBreakdown = {
            slug: slug,
            contractAddress: colInfo.contractAddress,
            name: collectionData.name,
            imageUrl: collectionData.image_url,
            nftCount: nftCount,
            floorPriceEth: floorPriceEth,
            totalValueEth: collectionValueEth,
          };
          if (ethPriceUsd && floorPriceEth > 0) {
            breakdownItem.floorPriceUsd = floorPriceEth * ethPriceUsd;
            breakdownItem.totalValueUsd = collectionValueEth * ethPriceUsd;
          }
          breakdown.push(breakdownItem);
        } else {
          console.log(
            `[Portfolio Worker] Skipping collection ${slug} in breakdown (fetch failed).`
          );
        }
      });

      // Sort breakdown by total ETH value descending
      breakdown.sort((a, b) => b.totalValueEth - a.totalValueEth);

      // 6. Construct final summary data
      const summaryData: PortfolioSummaryData = {
        totalValueEth: totalValueEth,
        nftCount: totalNftCount,
        collectionCount: collectionsMap.size, // Count of collections with NFTs
        breakdown: breakdown,
        calculatedAt: new Date().toISOString(),
      };
      if (ethPriceUsd) {
        summaryData.totalValueUsd = totalValueEth * ethPriceUsd;
        summaryData.ethPriceUsd = ethPriceUsd;
      }

      // 7. Store result in Redis cache
      const cacheKey = `${CACHE_PREFIX}${address}`;
      await redisClient.set(
        cacheKey,
        JSON.stringify(summaryData),
        'EX',
        CACHE_TTL_SECONDS
      );
      console.log(
        `[Portfolio Worker] Calculation complete for ${address}. Stored summary in cache.`
      );
    } catch (error) {
      console.error(
        `[Portfolio Worker] FATAL Error calculating portfolio for ${address} (Job ID: ${job.id}):`,
        error
      );
      // Rethrow to let BullMQ handle failure/retries based on job options
      throw error;
    }
  },
  { connection: redisClient, concurrency: 5 } // Limit how many portfolio calculations run at once
);

// --- Function to add job to the Queue --- (Called by API Controller)
export async function addPortfolioJob(data: PortfolioJobData): Promise<void> {
  const jobId = data.address; // Use address as Job ID for deduplication
  console.log(
    `[Portfolio Queue] Request to add job for address: ${data.address} (Job ID: ${jobId})`
  );

  // Optional: Check if job with this ID already exists and is active/waiting
  // const existingJob = await portfolioQueue.getJob(jobId);
  // if (existingJob && (await existingJob.isActive() || await existingJob.isWaiting())) {
  //    console.log(`[Portfolio Queue] Job ${jobId} already active/waiting. Skipping.`);
  //    return; // Don't add duplicates
  // }

  await portfolioQueue.add('calculate-portfolio', data, {
    jobId: jobId,
    // attempts: 1 // Maybe override default attempts? Make it try only once?
  });
  console.log(
    `[Portfolio Queue] Added job ${jobId} for address: ${data.address}`
  );
}

// --- Worker Event Listeners ---
worker.on('completed', (job) => {
  console.log(
    `[Portfolio Worker] Job ${job.id} (${job.data.address}) completed.`
  );
});

worker.on('failed', (job, err) => {
  console.error(
    `[Portfolio Worker] Job ${job?.id} (${job?.data?.address}) failed after ${job?.attemptsMade} attempts:`,
    err.message
  );
});

worker.on('error', (err) => {
  console.error('[Portfolio Worker] Generic worker error:', err);
});

console.log('[Portfolio Worker] Portfolio calculation worker service started.');

// Ensure this service is imported/started in server.ts
// e.g., import './services/portfolioCalculatorService';
