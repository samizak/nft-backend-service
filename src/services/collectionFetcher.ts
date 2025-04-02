import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import pLimit from 'p-limit';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';

import redisClient from '../lib/redis'; // Use our configured client
import { CollectionInfo, PriceData } from '../api/collection/types';

dotenv.config();

// --- Configuration & Constants ---
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';
const QUEUE_NAME = 'collection-fetch-queue';
const CACHE_PREFIX = 'collection:'; // Prefix for Redis keys
const CACHE_TTL_SECONDS = 60 * 60 * 4; // Cache TTL (e.g., 4 hours)

// Use the same rate limiting constants from collection service for consistency
const MAX_CONCURRENT_OS_REQUESTS = 5;
const MAX_RETRIES_PER_FETCH = 3; // Max retries for the worker fetch attempts
const INITIAL_RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;

// --- Helper Functions ---
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// --- Placeholder Fetch Functions ---
// IMPORTANT: Replace these placeholder implementations with the actual logic
// from src/api/collection/service.ts or a refactored shared utility.
// Ensure they THROW errors on actual failure (except 404 for price).

async function fetchSingleCollectionInfo(
  slug: string
): Promise<CollectionInfo> {
  const url = `${OPENSEA_API_BASE}/collections/${slug}`;
  console.log(`[Info Fetch] Attempting for: ${slug}`);

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': OPENSEA_API_KEY,
      },
      timeout: FETCH_TIMEOUT_MS,
    });

    const collection = response.data;
    if (!collection || !collection.collection) {
      throw new Error(`Invalid data structure received for collection ${slug}`);
    }

    return {
      collection: collection.collection,
      name: collection.name,
      description: collection.description,
      image_url: collection.image_url,
      safelist_status: collection.safelist_request_status,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `[Info Fetch Error] Axios error for ${slug}: ${error.response?.status} ${error.message}`
      );
      throw error;
    } else {
      console.error(`[Info Fetch Error] Non-Axios error for ${slug}:`, error);
      throw new Error(
        `Failed to fetch collection info for ${slug} due to non-HTTP error`
      );
    }
  }
}

async function fetchFloorPrice(slug: string): Promise<PriceData> {
  const url = `${OPENSEA_API_BASE}/listings/collection/${slug}/best`;
  console.log(`[Price Fetch] Attempting for: ${slug}`);

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': OPENSEA_API_KEY,
      },
      timeout: FETCH_TIMEOUT_MS,
    });

    const data = response.data;
    const floorData = data.listings?.[0]?.price?.current?.value;
    let floorPrice = 0;
    if (floorData) {
      try {
        floorPrice = parseFloat(floorData) / Math.pow(10, 18);
        if (isNaN(floorPrice)) floorPrice = 0;
      } catch {
        floorPrice = 0;
      }
    }

    return {
      collection: slug,
      floor_price: floorPrice,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        console.warn(
          `[Price Fetch] No listings found for collection ${slug}, setting floor to 0.`
        );
        return { collection: slug, floor_price: 0 };
      }
      console.error(
        `[Price Fetch Error] Axios error for ${slug}: ${error.response?.status} ${error.message}`
      );
      throw error;
    } else {
      console.error(`[Price Fetch Error] Non-Axios error for ${slug}:`, error);
      throw new Error(
        `Failed to fetch floor price for ${slug} due to non-HTTP error`
      );
    }
  }
}

// --- BullMQ Queue Definition ---
const collectionQueue = new Queue<{ slug: string }>(QUEUE_NAME, {
  connection: redisClient,
  defaultJobOptions: {
    attempts: MAX_RETRIES_PER_FETCH + 1, // BullMQ attempts = initial try + retries
    backoff: {
      type: 'exponential',
      delay: INITIAL_RETRY_DELAY_MS,
    },
    removeOnComplete: { count: 1000, age: 60 * 60 * 24 }, // Keep last 1000 completed jobs for 24h
    removeOnFail: { count: 5000, age: 60 * 60 * 24 * 7 }, // Keep last 5000 failed jobs for 7d
  },
});

// --- BullMQ Worker Definition ---
const limit = pLimit(MAX_CONCURRENT_OS_REQUESTS);

const worker = new Worker<{ slug: string }>(
  QUEUE_NAME,
  async (job: Job<{ slug: string }>) => {
    const { slug } = job.data;
    console.log(
      `[Worker] Processing job ${job.id} for slug: ${slug} (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`
    );

    if (!OPENSEA_API_KEY) {
      console.error(
        `[Worker] Skipping job ${job.id} (${slug}): Missing OpenSea API Key.`
      );
      throw new Error('Missing OpenSea API Key in worker.'); // Fail the job permanently
    }

    try {
      // Use p-limit to constrain the actual fetching logic block
      // Note: BullMQ's own concurrency option also helps manage worker processes
      const result = await limit(async () => {
        console.log(`[Worker:Fetch] Fetching data for ${slug} (Job ${job.id})`);
        // Fetch info and price - functions throw errors on failure (except price 404)
        // Use Promise.allSettled to ensure both run even if one fails early on a given attempt
        const [infoResult, priceResult] = await Promise.allSettled([
          fetchSingleCollectionInfo(slug),
          fetchFloorPrice(slug),
        ]);

        // Process results: If any failed, throw the error to trigger BullMQ retry
        if (infoResult.status === 'rejected') throw infoResult.reason;
        if (priceResult.status === 'rejected') throw priceResult.reason;

        // If both succeeded
        return { info: infoResult.value, price: priceResult.value };
      });

      // --- Cache Update ---
      const cacheKey = `${CACHE_PREFIX}${slug}`;
      // Store info and price separately? Or together? Storing together for simplicity now.
      const cacheValue = JSON.stringify({
        info: result.info,
        price: result.price,
        lastUpdated: new Date().toISOString(), // Add timestamp
        source: 'worker-cache', // Indicate source
      });

      // Set cache with TTL
      await redisClient.set(cacheKey, cacheValue, 'EX', CACHE_TTL_SECONDS);
      console.log(
        `[Worker] Successfully fetched and cached data for ${slug} (Job ${job.id}). Key: ${cacheKey}`
      );
    } catch (error: any) {
      console.error(
        `[Worker] Job ${job.id} (${slug}) failed attempt ${job.attemptsMade + 1}:`,
        error.message || error
      );
      // Re-throw the error to let BullMQ handle the retry based on queue options and attempt count
      throw error;
    }
  },
  { connection: redisClient, concurrency: MAX_CONCURRENT_OS_REQUESTS } // Worker concurrency
);

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} (${job.data.slug}) completed.`);
});

worker.on('failed', (job, err) => {
  // This logs after all retry attempts have failed
  console.error(
    `[Worker] Job ${job?.id} (${job?.data?.slug}) failed permanently after ${job?.attemptsMade} attempts:`,
    err.message
  );
});

worker.on('error', (err) => {
  // Generic worker errors (e.g., connection issues)
  console.error('[Worker] Generic worker error:', err);
});

// --- Function to Add Slugs to the Queue ---
// Callable from the API service
export async function addCollectionToQueue(slug: string): Promise<void> {
  try {
    const jobId = `fetch-${slug}`; // Create a predictable job ID
    // Add the job. If a job with this ID already exists and is pending/active,
    // it won't be added again. If it failed, it might be retried depending on options.
    // If it completed, adding it again will run it again.
    await collectionQueue.add('fetch-collection', { slug }, { jobId });
    console.log(`[Queue] Added/Requested job ${jobId} for slug: ${slug}`);
  } catch (error) {
    console.error(`[Queue] Error adding job for slug ${slug}:`, error);
  }
}

// --- Optional: Function to trigger updates for multiple slugs ---
export async function addCollectionsToQueue(slugs: string[]): Promise<void> {
  console.log(`[Queue] Requesting updates for ${slugs.length} slugs.`);
  // Use Promise.allSettled for adding multiple jobs without failing all if one fails
  const results = await Promise.allSettled(
    slugs.map((slug) => addCollectionToQueue(slug))
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(
      `[Queue] Failed to add ${failed} out of ${slugs.length} slugs to the queue.`
    );
  }
}

// --- Optional: Add a recurring job to refresh stale cache entries ---
// (Could be added later if needed)
// async function setupRecurringRefresh() {
//    await collectionQueue.add(
//        'refresh-stale-collections',
//        {},
//        {
//            repeat: { every: 60 * 60 * 1000 }, // Repeat every hour
//            jobId: 'recurring-refresh'
//        }
//    );
// }
// setupRecurringRefresh();

console.log('Collection Fetcher Service (Queue & Worker) initialized.');

// Worker needs to be explicitly started/imported in the main server process.
// e.g., import './services/collectionFetcher'; in server.ts
