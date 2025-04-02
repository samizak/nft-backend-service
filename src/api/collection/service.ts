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
import {
  fetchNFTGOFloorPrice,
  fetchNFTGOCollectionInfo,
} from '../../services/nftgoFetcher';

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
  const results: Record<string, CollectionResult> = {};
  const slugsToFetch: string[] = [];

  // Check cache for each slug
  for (const slug of collectionSlugs) {
    try {
      const cachedData = await redisClient.get(`collection:${slug}`);
      if (cachedData) {
        console.log(`[Cache] Found cached data for ${slug}`);
        const parsedData = JSON.parse(cachedData);

        // Transform cached data to match CollectionResult interface
        if (parsedData.info && parsedData.price) {
          // Old cache format with info and price
          results[slug] = {
            collection: slug,
            floor_price: parsedData.price.floor_price || 0,
            total_supply: parsedData.info.stats?.total_supply || 0,
            owner_count: parsedData.info.stats?.num_owners || 0,
            total_volume: parsedData.info.stats?.total_volume || 0,
            market_cap: parsedData.info.stats?.market_cap || 0,
          };
        } else if (parsedData.collection) {
          // New cache format with direct CollectionResult
          results[slug] = parsedData;
        } else {
          console.warn(
            `[Cache] Invalid cache format for ${slug}, will refetch`
          );
          slugsToFetch.push(slug);
        }
      } else {
        console.log(`[Cache] No cached data for ${slug}, will fetch`);
        slugsToFetch.push(slug);
      }
    } catch (error) {
      console.error(`[Cache Error] Error checking cache for ${slug}:`, error);
      slugsToFetch.push(slug);
    }
  }

  // If we have slugs to fetch, process them
  if (slugsToFetch.length > 0) {
    console.log(
      `[Fetch] Processing ${slugsToFetch.length} uncached collections`
    );
    const limit = pLimit(5); // Limit concurrent requests to 5
    const fetchPromises = slugsToFetch.map((slug) =>
      limit(async () => {
        try {
          console.log(`[Fetch] Starting fetch for ${slug}`);
          const collectionData = await fetchCollectionData(slug);
          console.log(
            `[Fetch] Successfully fetched data for ${slug}:`,
            collectionData
          );

          // Cache the result
          try {
            await redisClient.set(
              `collection:${slug}`,
              JSON.stringify(collectionData),
              'EX',
              3600
            );
            console.log(`[Cache] Cached data for ${slug}`);
          } catch (cacheError) {
            console.error(
              `[Cache Error] Failed to cache data for ${slug}:`,
              cacheError
            );
          }

          results[slug] = collectionData;
        } catch (error) {
          console.error(
            `[Fetch Error] Failed to fetch data for ${slug}:`,
            error
          );
          results[slug] = {
            collection: slug,
            floor_price: 0,
            total_supply: 0,
            owner_count: 0,
            total_volume: 0,
            market_cap: 0,
          };
        }
      })
    );

    await Promise.all(fetchPromises);
  }

  return { data: results };
}

async function fetchCollectionData(slug: string): Promise<CollectionResult> {
  console.log(`[Fetch] Starting collection data fetch for ${slug}`);

  // First get the contract address from OpenSea
  const url = `${OPENSEA_API_BASE}/collections/${slug}`;
  console.log(`[Fetch] Getting contract address from OpenSea for: ${slug}`);

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': OPENSEA_API_KEY,
      },
      timeout: FETCH_TIMEOUT_MS,
    });

    console.log(`[Fetch] OpenSea response for ${slug}:`, response.data);

    const contractAddress = response.data.contracts?.[0]?.address;
    if (!contractAddress) {
      console.warn(`[Fetch] No contract address found for collection ${slug}`);
      return {
        collection: slug,
        floor_price: 0,
        total_supply: 0,
        owner_count: 0,
        total_volume: 0,
        market_cap: 0,
      };
    }

    // Now fetch floor price from NFTGO
    console.log(
      `[Fetch] Getting floor price from NFTGO for: ${contractAddress}`
    );
    const floorPrices = await fetchNFTGOFloorPrice(contractAddress);
    console.log(
      `[Fetch] NFTGO floor prices for ${contractAddress}:`,
      floorPrices
    );

    // Find the OpenSea floor price if available, otherwise use the first one
    const openseaFloorPrice = floorPrices.find(
      (p) => p.marketplace.toLowerCase() === 'opensea'
    );
    const floorPrice =
      openseaFloorPrice?.floor_price || floorPrices[0]?.floor_price || 0;

    // Get collection info from NFTGO
    console.log(
      `[Fetch] Getting collection info from NFTGO for: ${contractAddress}`
    );
    const collectionInfo = await fetchNFTGOCollectionInfo([contractAddress]);
    console.log(
      `[Fetch] NFTGO collection info for ${contractAddress}:`,
      collectionInfo
    );

    const info = collectionInfo[0] || {
      total_supply: 0,
      owner_count: 0,
      total_volume: 0,
      market_cap: 0,
    };

    return {
      collection: slug,
      floor_price: floorPrice,
      total_supply: info.total_supply,
      owner_count: info.owner_count,
      total_volume: info.total_volume,
      market_cap: info.market_cap,
    };
  } catch (error) {
    console.error(`[Fetch Error] Error fetching data for ${slug}:`, error);
    throw error;
  }
}

async function fetchSingleCollectionInfo(
  slug: string
): Promise<{ info: CollectionInfo; price: PriceData }> {
  const startTime = performance.now();
  console.log(`[SingleCollection] START - Fetching ${slug}.`);

  try {
    const [infoResponse, priceResponse] = await Promise.all([
      axios.get(`${OPENSEA_API_BASE}/collections/${slug}`, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': OPENSEA_API_KEY,
        },
        timeout: FETCH_TIMEOUT_MS,
      }),
      axios.get(`${OPENSEA_API_BASE}/listings/collection/${slug}/best`, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': OPENSEA_API_KEY,
        },
        timeout: FETCH_TIMEOUT_MS,
      }),
    ]);

    const info = infoResponse.data.collection;
    const floorData = priceResponse.data.listings?.[0]?.price?.current?.value;
    let floorPrice = 0;
    if (floorData) {
      try {
        floorPrice = parseFloat(floorData) / Math.pow(10, 18);
        if (isNaN(floorPrice)) floorPrice = 0;
      } catch {
        floorPrice = 0;
      }
    }

    const result = {
      info,
      price: { collection: slug, floor_price: floorPrice },
    };

    const endTime = performance.now();
    console.log(
      `[SingleCollection] END - Took ${(endTime - startTime).toFixed(2)} ms.`
    );

    return result;
  } catch (error) {
    console.error(`[SingleCollection] Error fetching ${slug}:`, error);
    throw error;
  }
}

async function fetchFloorPrice(slug: string): Promise<PriceData> {
  try {
    const url = `${OPENSEA_API_BASE}/collections/${slug}`;
    console.log(`[Price Fetch] Getting collection data for: ${slug}`);

    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': OPENSEA_API_KEY,
      },
      timeout: FETCH_TIMEOUT_MS,
    });

    const floorPrice = response.data.collection?.stats?.floor_price || 0;
    return { collection: slug, floor_price: floorPrice };
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

export async function clearCollectionCache(slugs: string[]): Promise<void> {
  console.log(`[Cache Clear] Clearing cache for ${slugs.length} collections`);
  const deletePromises = slugs.map(async (slug) => {
    try {
      await redisClient.del(`collection:${slug}`);
      console.log(`[Cache Clear] Cleared cache for ${slug}`);
    } catch (error) {
      console.error(
        `[Cache Clear Error] Failed to clear cache for ${slug}:`,
        error
      );
    }
  });
  await Promise.all(deletePromises);
  console.log('[Cache Clear] Finished clearing cache');
}

interface CollectionData {
  slug: string;
  contractAddress: string;
}

async function processCollection(
  slug: string,
  contractAddress: string
): Promise<CollectionResult | null> {
  console.log(
    `[Task Start] Processing collection: ${slug} (${contractAddress})`
  );
  let info: CollectionInfo | null = null;
  let price: PriceData | null = null;
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const [infoResponse, priceResponse]: [
        { info: CollectionInfo; price: PriceData },
        PriceData,
      ] = await Promise.all([
        info
          ? Promise.resolve({
              info,
              price: { collection: slug, floor_price: 0 },
            })
          : fetchSingleCollectionInfo(slug),
        price ? Promise.resolve(price) : fetchFloorPrice(slug),
      ]);

      info = infoResponse.info;
      price = priceResponse;

      if (info && price) {
        console.log(
          `[Task Success] Both info and price fetched for ${slug} on attempt ${attempt}.`
        );
        break;
      }

      let shouldRetry = false;
      let specificDelay = 0;

      const errorsToCheck = [];
      if (!info)
        errorsToCheck.push(new Error('Failed to fetch collection info'));
      if (!price) errorsToCheck.push(new Error('Failed to fetch floor price'));

      if (errorsToCheck.length === 0) {
        break;
      }

      lastError = errorsToCheck[0];

      for (const error of errorsToCheck) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 429) {
            shouldRetry = true;
            const retryAfterHeader = error.response?.headers?.['retry-after'];
            if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
              specificDelay = Number(retryAfterHeader) * 1000;
              console.warn(
                `[Task Retry] Rate limit (429) for ${slug}. Retrying after ${specificDelay / 1000}s (from header)...`
              );
            } else {
              specificDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
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
          console.error(`[Task Error] Non-retryable error for ${slug}:`, error);
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

  if (!info || !price) {
    return null;
  }

  return {
    collection: slug,
    floor_price: price.floor_price,
    total_supply: info.stats.total_supply,
    owner_count: info.stats.num_owners,
    total_volume: info.stats.total_volume,
    market_cap: info.stats.market_cap,
  };
}

export async function fetchBatchCollectionData(
  slugs: string[],
  contractAddresses: string[]
): Promise<BatchCollectionsResponse> {
  if (!OPENSEA_API_KEY) {
    console.error('OpenSea API key is missing. Cannot fetch collection data.');
    return { data: {} };
  }

  const limit = pLimit(MAX_CONCURRENT_REQUESTS);
  const results: Record<string, CollectionResult> = {};

  const tasks = slugs.map((slug, index) => {
    const contractAddress = contractAddresses[index];
    return limit(() => processCollection(slug, contractAddress));
  });

  const collectionResults = await Promise.all(tasks);

  collectionResults.forEach((result) => {
    if (result) {
      results[result.collection] = {
        collection: result.collection,
        floor_price: result.floor_price,
        total_supply: result.total_supply,
        owner_count: result.owner_count,
        total_volume: result.total_volume,
        market_cap: result.market_cap,
      };
    }
  });

  console.log('Finished processing all collections.');
  console.log('Results:', results);

  return { data: results };
}
