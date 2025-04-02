import { env } from 'process';
import axios, { AxiosError } from 'axios';
import pLimit from 'p-limit';
import redisClient from '../../lib/redis'; // Import Redis client
import { addCollectionsToQueue } from '../../services/collectionFetcher'; // Import queue function
import CollectionDataModel from '../../models/CollectionData'; // Import the model
import {
  CollectionInfo,
  PriceData,
  CollectionResult,
  BatchCollectionsResponse,
} from './types';
import { performance } from 'perf_hooks'; // For more accurate timing

const OPENSEA_API_KEY = env.OPENSEA_API_KEY || '';
const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';

const MAX_CONCURRENT_REQUESTS = 5;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;
const CACHE_PREFIX = 'collection:'; // Cache key prefix (must match worker)
const CACHE_TTL_SECONDS = 4 * 60 * 60; // Cache for 4 hours (as defined in worker)

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function getBatchCollectionDataFromCache(
  collectionSlugs: string[]
): Promise<BatchCollectionsResponse> {
  const startTime = performance.now(); // Start timer
  const numRequested = collectionSlugs.length;
  console.log(`[BatchCollections] START - Requesting ${numRequested} slugs.`);

  const results: { [collectionSlug: string]: CollectionResult } = {};
  const cacheKeys = collectionSlugs.map((slug) => `${CACHE_PREFIX}${slug}`);
  let slugsMissingFromCache: string[] = [];
  const slugsToQueueForRefresh: string[] = [];
  let numCacheHits = 0;
  let numDbHits = 0;
  let numQueued = 0;

  // 1. Check Redis Cache
  try {
    const redisStartTime = performance.now();
    console.log(
      `[BatchCollections Cache] Checking cache for ${numRequested} slugs.`
    );
    const cachedData = await redisClient.mget(cacheKeys);
    const redisEndTime = performance.now();
    console.log(
      `[BatchCollections Cache] Redis mget took ${(redisEndTime - redisStartTime).toFixed(2)} ms.`
    );

    // Process cache results *before* pushing misses
    cachedData.forEach((item, index) => {
      const slug = collectionSlugs[index];
      if (item) {
        // Cache Hit candidate
        try {
          const parsedItem = JSON.parse(item);
          if (
            parsedItem &&
            typeof parsedItem === 'object' &&
            parsedItem.info !== undefined
          ) {
            // Check structure minimally
            results[slug] = { info: parsedItem.info, price: parsedItem.price };
            numCacheHits++; // Increment count *only* for valid hits
          } else {
            console.warn(
              `[BatchCollections Cache] Invalid cache structure for ${slug}. Treating as miss.`
            );
            slugsMissingFromCache.push(slug);
          }
        } catch (parseError) {
          console.error(
            `[BatchCollections Cache] Parse error for ${slug}:`,
            parseError
          );
          slugsMissingFromCache.push(slug); // Treat parse error as miss
        }
      } else {
        // Explicit Cache Miss
        slugsMissingFromCache.push(slug);
      }
    });
    // Note: numCacheHits is now accurate
    console.log(
      `[BatchCollections Cache] Cache Hits: ${numCacheHits} / ${numRequested}. Misses: ${slugsMissingFromCache.length}.`
    );
  } catch (redisError) {
    console.error('[BatchCollections Cache] Redis mget error:', redisError);
    // If Redis fails, treat all requested slugs as potential misses from DB
    slugsMissingFromCache = [...collectionSlugs]; // Reset misses
    numCacheHits = 0; // Reset hits
  }

  // 2. Check MongoDB for Cache Misses
  if (slugsMissingFromCache.length > 0) {
    const numToCheckInDb = slugsMissingFromCache.length;
    let slugsStillMissing: string[] = []; // Renamed locally to avoid confusion
    try {
      const dbStartTime = performance.now();
      console.log(
        `[BatchCollections DB] Checking MongoDB for ${numToCheckInDb} cache misses.`
      );
      const dbResults = await CollectionDataModel.find(
        { slug: { $in: slugsMissingFromCache } }, // Find docs matching the missed slugs
        { slug: 1, info: 1, price: 1, dataLastFetchedAt: 1 } // Select necessary fields
      ).lean(); // Use .lean() for plain JS objects
      const dbEndTime = performance.now();
      numDbHits = dbResults.length; // Count how many were actually found
      console.log(
        `[BatchCollections DB] MongoDB find took ${(dbEndTime - dbStartTime).toFixed(2)} ms. Found ${numDbHits} / ${numToCheckInDb} requested.`
      );

      const foundInDbMap = new Map<string, (typeof dbResults)[0]>();
      dbResults.forEach((doc) => foundInDbMap.set(doc.slug, doc));

      for (const slug of slugsMissingFromCache) {
        const dbDoc = foundInDbMap.get(slug);
        if (dbDoc) {
          // MongoDB Hit (after cache miss)
          // console.log(`[API DB Check] Hit for ${slug}.`); // Reduce noise
          results[slug] = {
            info: dbDoc.info ?? undefined,
            price: dbDoc.price ?? undefined,
          };

          // Add data to Redis cache asynchronously (warm cache)
          const fetchedAt = dbDoc.dataLastFetchedAt || new Date(0); // Use stored fetch time or epoch
          const dataToCache = {
            info: dbDoc.info,
            price: dbDoc.price,
            lastUpdated: fetchedAt.toISOString(),
            source: 'db-warm-cache', // Indicate source
          };
          redisClient
            .set(
              `${CACHE_PREFIX}${slug}`,
              JSON.stringify(dataToCache),
              'EX',
              CACHE_TTL_SECONDS
            )
            .catch((err) =>
              console.error(
                `[BatchCollections DB] Failed to warm cache for ${slug}:`,
                err
              )
            );
        } else {
          // MongoDB Miss (after cache miss)
          // console.log(`[API DB Check] Miss for ${slug}.`); // Reduce noise
          results[slug] = {}; // Ensure placeholder exists
          slugsStillMissing.push(slug); // Add to final missing list
        }
      }
      // Slugs needing fetch from OpenSea are in slugsStillMissing
      slugsToQueueForRefresh.push(...slugsStillMissing);
      numQueued = slugsToQueueForRefresh.length; // Update final count
      console.log(
        `[BatchCollections DB] Total DB Hits: ${numDbHits}. Final Missing (Queued): ${numQueued}.`
      );
    } catch (dbError) {
      console.error('[BatchCollections DB] MongoDB find error:', dbError);
      // If DB lookup fails, treat all cache misses as needing refresh
      slugsToQueueForRefresh.push(...slugsMissingFromCache);
      numQueued = slugsToQueueForRefresh.length; // Update final count
      numDbHits = 0; // Reset DB hits
      slugsMissingFromCache.forEach((slug) => {
        if (!results[slug]) results[slug] = {};
      });
    }
  }

  // 3. Queue Background Refresh for Final Misses
  if (slugsToQueueForRefresh.length > 0) {
    console.log(
      `[BatchCollections Queue] Queuing ${numQueued} slugs for background fetch.`
    );
    addCollectionsToQueue(slugsToQueueForRefresh).catch((queueError) => {
      console.error(
        '[BatchCollections Queue] Failed to add missing slugs to queue:',
        queueError
      );
    });
  }

  // 4. Return Combined Results
  collectionSlugs.forEach((slug) => {
    if (!results[slug]) {
      console.warn(
        `[Result Check] No results found for ${slug} after processing, adding empty entry.`
      );
      results[slug] = {};
    }
  });

  const endTime = performance.now(); // End timer
  const duration = (endTime - startTime).toFixed(2);
  console.log(
    `[BatchCollections] END - Took ${duration} ms. Requested: ${numRequested}, CacheHits: ${numCacheHits}, DbHits: ${numDbHits}, Queued: ${numQueued}`
  );

  return { data: results };
}

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

export async function fetchBatchCollectionData(
  collectionSlugs: string[]
): Promise<BatchCollectionsResponse> {
  if (!OPENSEA_API_KEY) {
    console.error('OpenSea API key is missing. Cannot fetch collection data.');
    return { data: {} };
  }

  const limit = pLimit(MAX_CONCURRENT_REQUESTS);
  const results: { [collectionSlug: string]: CollectionResult } = {};

  const tasks = collectionSlugs.map((slug) =>
    limit(async () => {
      console.log(`[Task Start] Processing slug: ${slug}`);
      let info: CollectionInfo | null = null;
      let price: PriceData | null = null;
      let lastError: any = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const [infoResult, priceResult]: [
            PromiseSettledResult<CollectionInfo>,
            PromiseSettledResult<PriceData>,
          ] = await Promise.allSettled([
            info ? Promise.resolve(info) : fetchSingleCollectionInfo(slug),
            price ? Promise.resolve(price) : fetchFloorPrice(slug),
          ]);

          if (infoResult.status === 'fulfilled') {
            info = infoResult.value;
          }
          if (priceResult.status === 'fulfilled') {
            price = priceResult.value;
          }

          if (info && price) {
            console.log(
              `[Task Success] Both info and price fetched for ${slug} on attempt ${attempt}.`
            );
            break;
          }

          let shouldRetry = false;
          let specificDelay = 0;

          const errorsToCheck = [];
          if (infoResult.status === 'rejected')
            errorsToCheck.push(infoResult.reason);
          if (priceResult.status === 'rejected')
            errorsToCheck.push(priceResult.reason);

          if (errorsToCheck.length === 0) {
            break;
          }

          lastError = errorsToCheck[0];

          for (const error of errorsToCheck) {
            if (axios.isAxiosError(error)) {
              const status = error.response?.status;
              if (status === 429) {
                shouldRetry = true;
                const retryAfterHeader =
                  error.response?.headers?.['retry-after'];
                if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
                  specificDelay = Number(retryAfterHeader) * 1000;
                  console.warn(
                    `[Task Retry] Rate limit (429) for ${slug}. Retrying after ${specificDelay / 1000}s (from header)...`
                  );
                } else {
                  specificDelay =
                    INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                  console.warn(
                    `[Task Retry] Rate limit (429) for ${slug}. Retrying after ${specificDelay / 1000}s (exponential backoff)...`
                  );
                }
                break;
              } else if (status && status >= 500 && status < 600) {
                shouldRetry = true;
                specificDelay = Math.max(
                  specificDelay,
                  INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
                );
                console.warn(
                  `[Task Retry] Server error (${status}) for ${slug}. Retrying after ${specificDelay / 1000}s...`
                );
              }
            } else {
              console.error(
                `[Task Error] Non-retryable error for ${slug}:`,
                error
              );
            }
          }

          if (!shouldRetry || attempt === MAX_RETRIES) {
            console.warn(
              `[Task Skip/Fail] No more retries for ${slug} (attempt ${attempt}/${MAX_RETRIES}). Last error:`,
              lastError?.message || lastError
            );
            break;
          }

          await sleep(specificDelay);
        } catch (unexpectedError) {
          console.error(
            `[Task Critical] Unexpected error during retry loop for ${slug}:`,
            unexpectedError
          );
          lastError = unexpectedError;
          break;
        }
      }

      results[slug] = {
        info: info ?? undefined,
        price: price ?? undefined,
      };
      console.log(
        `[Task End] Finished processing slug: ${slug}. Info: ${!!info}, Price: ${!!price}`
      );
    })
  );

  await Promise.allSettled(tasks);

  console.log('Finished processing all slugs.');

  collectionSlugs.forEach((slug) => {
    if (!results[slug]) {
      console.warn(
        `[Result Check] No results found for ${slug} after processing, adding empty entry.`
      );
      results[slug] = {};
    }
  });

  return { data: results };
}
