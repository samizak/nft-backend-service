import { env } from 'process';
import axios, { AxiosError } from 'axios';
import pLimit from 'p-limit';
import {
  CollectionInfo,
  PriceData,
  CollectionResult,
  BatchCollectionsResponse,
} from './types';

const OPENSEA_API_KEY = env.OPENSEA_API_KEY || '';
const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';

const MAX_CONCURRENT_REQUESTS = 5;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
