import { Queue, Worker, Job } from 'bullmq';
import dotenv from 'dotenv';

import redisClient from '../lib/redis'; // Use our configured client
import CollectionDataModel from '../models/CollectionData'; // Keep for DB update

// Import the centralized utility function and types
import {
  fetchCollectionData as fetchCollectionDataUtil,
  CombinedCollectionData,
} from '../utils/collectionApi';

dotenv.config();

// --- Configuration & Constants ---
const QUEUE_NAME = 'collection-fetch-queue';
const CACHE_PREFIX = 'collection:'; // Prefix for Redis keys
const CACHE_TTL_SECONDS = 60 * 60 * 4; // Cache TTL (e.g., 4 hours)

const MAX_CONCURRENT_OS_REQUESTS = 5; // Limit for worker concurrency
const MAX_RETRIES_PER_FETCH = 3; // Used for BullMQ job options
const INITIAL_RETRY_DELAY_MS = 1000; // Used for BullMQ job options

// --- BullMQ Queue Definition ---
interface CollectionJobData {
  // Define expected job data structure
  slug: string;
  contractAddress?: string; // Make optional for now, but required for util
}
const collectionQueue = new Queue<CollectionJobData>(QUEUE_NAME, {
  connection: redisClient,
  defaultJobOptions: {
    attempts: MAX_RETRIES_PER_FETCH + 1,
    backoff: {
      type: 'exponential',
      delay: INITIAL_RETRY_DELAY_MS,
    },
    removeOnComplete: { count: 1000, age: 60 * 60 * 24 },
    removeOnFail: { count: 5000, age: 60 * 60 * 24 * 7 },
  },
});

// --- BullMQ Worker Definition ---

const worker = new Worker<CollectionJobData>(
  QUEUE_NAME,
  async (job: Job<CollectionJobData>) => {
    // Dynamically import p-limit inside the async job handler
    const pLimit = (await import('p-limit')).default;
    const limit = pLimit(MAX_CONCURRENT_OS_REQUESTS); // Instantiate limiter here

    const { slug, contractAddress } = job.data;

    // --- TEMPORARY CHECK - REMOVE LATER ---
    if (!contractAddress) {
      console.error(
        `[Worker] Job ${job.id} (${slug}) missing contractAddress! Skipping. Job data needs update.`
      );
      // Fail the job for now if address is missing, as the util requires it.
      // Alternatively, could try a slug-only fetch if util supports it, but less ideal.
      throw new Error(`Contract address missing for slug ${slug}`);
    }
    // ----------------------------------------

    console.log(
      `[Worker] Processing job ${job.id} for slug: ${slug}, address: ${contractAddress} (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`
    );

    try {
      // Use the dynamically imported and instantiated limit
      const combinedData: CombinedCollectionData = await limit(() =>
        fetchCollectionDataUtil(slug, contractAddress)
      );

      // --- Cache and DB Update ---
      const fetchedAt = new Date();
      const cacheKey = `${CACHE_PREFIX}${slug}`;

      // Data to store is now the direct result from the utility
      // Add timestamp and source for context
      const dataToStore = {
        ...combinedData, // Spread the fetched data (slug, name, price, stats etc.)
        lastUpdated: fetchedAt.toISOString(),
        source: 'worker-cache',
      };
      const cacheValue = JSON.stringify(dataToStore);

      // 1. Update Redis Cache (with TTL)
      await redisClient.set(cacheKey, cacheValue, 'EX', CACHE_TTL_SECONDS);
      console.log(
        `[Worker] Updated Redis cache for ${slug} (Job ${job.id}). Key: ${cacheKey}`
      );

      // 2. Update MongoDB (Upsert)
      // Adapt the $set part to match the flattened CombinedCollectionData structure
      await CollectionDataModel.updateOne(
        { slug: slug },
        {
          $set: {
            name: combinedData.name,
            description: combinedData.description,
            image_url: combinedData.image_url,
            safelist_status: combinedData.safelist_status,
            floor_price: combinedData.floor_price,
            total_supply: combinedData.total_supply,
            num_owners: combinedData.num_owners,
            total_volume: combinedData.total_volume,
            market_cap: combinedData.market_cap,
            dataLastFetchedAt: fetchedAt,
          },
          $setOnInsert: { slug: slug },
        },
        { upsert: true }
      );
      console.log(
        `[Worker] Upserted MongoDB data for ${slug} (Job ${job.id}).`
      );
    } catch (error: any) {
      console.error(
        `[Worker] Job ${job.id} (${slug}) failed attempt ${job.attemptsMade + 1}:`,
        error.message || error
      );
      // Re-throw the error for BullMQ retry logic
      throw error;
    }
  },
  { connection: redisClient, concurrency: MAX_CONCURRENT_OS_REQUESTS }
);

// --- Worker Event Listeners (Remain the same) ---
worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} (${job.data.slug}) completed.`);
});

worker.on('failed', (job, err) => {
  console.error(
    `[Worker] Job ${job?.id} (${job?.data?.slug}) failed permanently after ${job?.attemptsMade} attempts:`,
    err.message
  );
});

worker.on('error', (err) => {
  console.error('[Worker] Generic worker error:', err);
});

// --- Function to Add Slugs to the Queue ---
// IMPORTANT: This function MUST be updated to accept and pass contractAddress!
export async function addCollectionsToQueue(
  collections: Array<{ slug: string; contractAddress: string }>
): Promise<void> {
  if (!Array.isArray(collections) || collections.length === 0) {
    console.warn('[Queue] Add request received with no valid collections.');
    return;
  }
  console.log(
    `[Queue] Attempting to add ${collections.length} collections to the queue.`
  );

  const jobs = collections.map((col) => ({
    name: col.slug, // Job name for easier identification
    data: { slug: col.slug, contractAddress: col.contractAddress }, // Pass both!
    opts: {
      jobId: col.slug, // Use slug as job ID for deduplication
      // override default opts per job if needed
    },
  }));

  try {
    const addedJobs = await collectionQueue.addBulk(jobs);
    console.log(`[Queue] Added ${addedJobs.length} jobs.`);
    addedJobs.forEach((job) => {
      console.log(
        ` - Job ID: ${job.id}, Name: ${job.name}, Data: ${JSON.stringify(job.data)}`
      );
    });
  } catch (error) {
    console.error('[Queue] Error adding jobs in bulk:', error);
  }
}

// --- Function to Add Single Slug (For testing or specific triggers) ---
// Also needs updating
export async function addSingleCollectionToQueue(
  slug: string,
  contractAddress: string
): Promise<void> {
  console.log(`[Queue] Adding single collection: ${slug} (${contractAddress})`);
  await collectionQueue.add(
    slug,
    { slug: slug, contractAddress: contractAddress },
    {
      jobId: slug, // Use slug as job ID for deduplication
    }
  );
}

// Function to get queue status (optional, for monitoring)
export async function getQueueStatus() {
  const counts = await collectionQueue.getJobCounts(
    'wait',
    'active',
    'completed',
    'failed',
    'delayed'
  );
  return counts;
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received, closing worker and queue...');
  await worker.close();
  await collectionQueue.close();
  console.log('[Worker] Closed worker and queue.');
  process.exit(0);
});

console.log('[Worker] Collection fetch worker started.');
