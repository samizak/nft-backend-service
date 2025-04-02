import pLimit from 'p-limit';
import redisClient from '../../lib/redis'; // Import Redis client
import { BatchCollectionsResponse, CollectionResponseItem } from './types';

// Import the new utility function and its return type
import {
  fetchCollectionData as fetchCollectionDataUtil,
  BasicCollectionInfo,
} from '../../utils/collectionApi';

// Constants
const MAX_CONCURRENT_REQUESTS = 5;
const CACHE_PREFIX = 'collection:'; // Define cache prefix
const CACHE_TTL_SECONDS = 60 * 60 * 4; // Use same TTL as worker for consistency

// --- Main API Service Logic ---

// Helper to adapt cached data (CombinedCollectionData + metadata) to API response item
function adaptCachedDataToResponseItem(
  cachedData: any
): CollectionResponseItem | null {
  // Basic validation of cached structure
  if (
    !cachedData ||
    typeof cachedData.slug !== 'string' ||
    typeof cachedData.floor_price !== 'number'
  ) {
    console.warn('[Cache Adapt] Invalid cached data structure:', cachedData);
    return null;
  }

  // Reconstruct the info and price parts expected by the API response
  const infoData: BasicCollectionInfo = {
    slug: cachedData.slug,
    name: cachedData.name ?? null,
    description: cachedData.description ?? null,
    image_url: cachedData.image_url ?? null,
    safelist_status: cachedData.safelist_status ?? null,
    total_supply: cachedData.total_supply ?? 0,
    num_owners: cachedData.num_owners ?? 0,
    total_volume: cachedData.total_volume ?? 0,
    market_cap: cachedData.market_cap ?? 0,
  };
  const priceData =
    cachedData.floor_price > 0 ? { floor_price: cachedData.floor_price } : null;

  return { info: infoData, price: priceData };
}

// processCollection now also handles writing to cache after fetch
async function processCollection(
  slug: string,
  contractAddress: string
): Promise<CollectionResponseItem | null> {
  console.log(
    `[API Service Process] Fetching fresh data via util: ${slug} (${contractAddress})`
  );
  try {
    // 1. Fetch fresh data
    const combinedData = await fetchCollectionDataUtil(slug, contractAddress);

    // 2. Write to cache (write-through)
    const cacheKey = `${CACHE_PREFIX}${slug}`;
    const fetchedAt = new Date();
    const dataToStore = {
      ...combinedData,
      lastUpdated: fetchedAt.toISOString(),
      source: 'api-fetch-cache', // Indicate source
    };
    try {
      await redisClient.set(
        cacheKey,
        JSON.stringify(dataToStore),
        'EX',
        CACHE_TTL_SECONDS
      );
      console.log(`[API Service Cache SET] Stored fresh data for ${slug}`);
    } catch (cacheError) {
      console.error(
        `[API Service Cache SET Error] Failed for ${slug}:`,
        cacheError
      );
      // Continue even if cache set fails
    }

    // 3. Adapt to API response format
    const infoData: BasicCollectionInfo = {
      slug: combinedData.slug,
      name: combinedData.name,
      description: combinedData.description,
      image_url: combinedData.image_url,
      safelist_status: combinedData.safelist_status,
      total_supply: combinedData.total_supply,
      num_owners: combinedData.num_owners,
      total_volume: combinedData.total_volume,
      market_cap: combinedData.market_cap,
    };
    const priceData =
      combinedData.floor_price > 0
        ? { floor_price: combinedData.floor_price }
        : null;
    return { info: infoData, price: priceData };
  } catch (error) {
    console.error(
      `[API Service Process] Error fetching collection data for ${slug} using util:`,
      error
    );
    return null;
  }
}

// Main exported function updated with cache read logic
export async function fetchBatchCollectionData(
  slugs: string[],
  contractAddresses: string[]
): Promise<BatchCollectionsResponse> {
  if (slugs.length === 0) {
    return { data: {} };
  }

  // Use Record<string, never> instead of {} for the empty object case
  const results: Record<
    string,
    CollectionResponseItem | Record<string, never>
  > = {};
  const misses: Array<{ slug: string; contractAddress: string }> = [];

  // 1. Check cache for all slugs first
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const contractAddress = contractAddresses[i];
    const cacheKey = `${CACHE_PREFIX}${slug}`;

    try {
      const cachedValue = await redisClient.get(cacheKey);
      if (cachedValue) {
        console.log(`[API Service Cache HIT] for slug: ${slug}`);
        const parsedData = JSON.parse(cachedValue);
        const adaptedData = adaptCachedDataToResponseItem(parsedData);
        if (adaptedData) {
          results[slug] = adaptedData;
        } else {
          console.warn(
            `[API Service Cache WARN] Invalid data in cache for ${slug}. Refetching.`
          );
          misses.push({ slug, contractAddress });
        }
      } else {
        console.log(`[API Service Cache MISS] for slug: ${slug}`);
        misses.push({ slug, contractAddress });
      }
    } catch (error) {
      console.error(`[API Service Cache GET Error] for slug ${slug}:`, error);
      // Treat cache error as a miss
      misses.push({ slug, contractAddress });
    }
  }

  // 2. Fetch data for cache misses
  if (misses.length > 0) {
    console.log(`[API Service] Fetching ${misses.length} cache misses.`);
    const limit = pLimit(MAX_CONCURRENT_REQUESTS);
    const tasks = misses.map((miss) =>
      limit(() => processCollection(miss.slug, miss.contractAddress))
    );

    const missResults = await Promise.allSettled(tasks);

    missResults.forEach((result, index) => {
      const slug = misses[index].slug;
      if (result.status === 'fulfilled' && result.value) {
        results[slug] = result.value; // Store the fetched & adapted data
      } else {
        console.warn(
          `[API Service] Failed to fetch cache miss for slug: ${slug}. Reason:`,
          result.status === 'rejected'
            ? result.reason
            : 'Processing returned null'
        );
        // Ensure failed fetches are represented by empty object in final response
        results[slug] = {} as Record<string, never>;
      }
    });
  }

  console.log(
    '[API Service] Finished processing all collections (cache + fetch).'
  );
  console.log(
    `[API Service] Returning results for slugs: ${Object.keys(results).join(', ')}`
  );

  // Revert: Keep the original return structure matching BatchCollectionsResponse type
  return { data: results };
}
