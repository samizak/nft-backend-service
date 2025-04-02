import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const NFTGO_API_BASE = 'https://data-api.nftgo.io/eth/v1';
const NFTGO_API_KEY = process.env.NFTGO_API_KEY || '';
const FETCH_TIMEOUT_MS = 15000; // 15 seconds

// --- Retry/Backoff Constants ---
const MAX_RETRIES = 3; // Max retries for individual API calls
const INITIAL_RETRY_DELAY_MS = 500; // Start with shorter delay for internal retries
const MAX_RETRY_DELAY_MS = 5 * 1000; // Max delay for internal retries (5 seconds)

// Define a simpler type for the basic data returned by fetchSingleCollectionInfo
export interface BasicCollectionInfo {
  slug: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  safelist_status: string | null;
  total_supply: number;
  num_owners: number;
  total_volume: number;
  market_cap: number;
}

// Floor price data structure from NFTGO
interface NftgoFloorPrice {
  marketplace: string;
  floor_price: number;
}

// Floor price data structure from OpenSea /listings/collection/{slug}/best
interface OpenseaListing {
  price?: {
    current?: {
      value?: string; // Price is in wei as a string
    };
  };
}

/**
 * Fetches basic collection information (name, image, basic stats) from OpenSea API.
 * Uses the /collections/{slug} endpoint.
 */
export async function fetchSingleCollectionInfo(
  slug: string
): Promise<BasicCollectionInfo> {
  const url = `${OPENSEA_API_BASE}/collections/${slug}`;
  console.log(`[Util Fetch Info] Attempting for: ${slug} at ${url}`);

  // Default return structure used on failure
  const defaultReturn: BasicCollectionInfo = {
    slug: slug,
    name: null,
    description: null,
    image_url: null,
    safelist_status: null,
    total_supply: 0,
    num_owners: 0,
    total_volume: 0,
    market_cap: 0,
  };

  if (!OPENSEA_API_KEY) {
    console.error('[Util Fetch Info] OpenSea API Key is missing.');
    return defaultReturn;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get<any>(url, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': OPENSEA_API_KEY,
        },
        timeout: FETCH_TIMEOUT_MS,
      });

      const collectionData = response.data;
      if (!collectionData) {
        console.warn(
          `[Util Fetch Info] No collection data object in response for slug: ${slug}`
        );
        return defaultReturn;
      }

      // Success - return the data
      return {
        slug: slug,
        name: collectionData.name ?? null,
        description: collectionData.description ?? null,
        image_url: collectionData.image_url ?? null,
        safelist_status: collectionData.safelist_request_status ?? null,
        total_supply:
          collectionData.total_supply ??
          collectionData.stats?.total_supply ??
          0,
        num_owners:
          collectionData.num_owners ?? collectionData.stats?.num_owners ?? 0,
        total_volume:
          collectionData.total_volume ??
          collectionData.stats?.total_volume ??
          0,
        market_cap:
          collectionData.market_cap ?? collectionData.stats?.market_cap ?? 0,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        let delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        delay = Math.min(delay, MAX_RETRY_DELAY_MS);

        console.warn(
          `[Util Fetch Info WARN] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed for ${slug}. Status: ${status || 'N/A'}. Message: ${error.message}`
        );

        if (status === 429) {
          let waitTime = delay;
          if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
            waitTime = Math.max(delay, Number(retryAfterHeader) * 1000 + 200); // Use header + buffer
          }
          if (attempt < MAX_RETRIES) {
            console.log(
              `   Rate limit hit. Retrying after ${waitTime / 1000}s...`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue; // Go to next attempt
          }
        } else if (status === 404) {
          console.warn(
            `   Collection ${slug} not found (404). Returning default.`
          );
          return defaultReturn;
        } else if (status && status >= 500) {
          // Retry on server errors
          if (attempt < MAX_RETRIES) {
            console.log(
              `   Server error (${status}). Retrying after ${delay / 1000}s...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        } else {
          // Other client errors (400, 401, 403 etc.) or unknown errors - don't retry
          console.error(
            `   Non-retryable Axios error. Status: ${status || 'N/A'}. Returning default.`
          );
          return defaultReturn;
        }
      } else {
        // Non-Axios error - don't retry
        console.error(
          `[Util Fetch Info Error] Non-Axios error for ${slug}:`,
          error
        );
        return defaultReturn;
      }
      // If loop finishes after max retries on retryable errors
      console.error(
        `[Util Fetch Info Error] Max retries (${MAX_RETRIES}) reached for ${slug}. Returning default.`
      );
    }
  } // End for loop

  return defaultReturn; // Should only be reached if max retries hit
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches floor price data from NFTGO API.
 */
async function fetchNFTGOFloorPriceInternal(
  contractAddress: string
): Promise<NftgoFloorPrice[]> {
  if (!NFTGO_API_KEY) {
    console.error('[Util NFTGO Fetch] API key is missing!');
    throw new Error('NFTGO API key is missing');
  }

  const url = `${NFTGO_API_BASE}/marketplace/${contractAddress.toLowerCase()}/floor-price`;
  console.log(
    `[Util NFTGO Fetch] Attempting for: ${contractAddress} at ${url}`
  );

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': NFTGO_API_KEY,
        },
        timeout: FETCH_TIMEOUT_MS,
      });

      if (
        !response.data ||
        !Array.isArray(response.data.collection_floor_price_list)
      ) {
        console.warn(
          `[Util NFTGO Fetch WARN] Invalid or empty floor price list for ${contractAddress}`
        );
        return [];
      }

      const floorPrices = response.data.collection_floor_price_list
        .map((item: any) => ({
          marketplace: item.marketplace_name,
          floor_price:
            typeof item.floor_price?.value === 'number'
              ? item.floor_price.value
              : 0,
        }))
        .filter((item: NftgoFloorPrice) => item.floor_price > 0);

      console.log(
        `[Util NFTGO Fetch] Success. Processed ${floorPrices.length} floor prices for ${contractAddress}`
      );
      return floorPrices;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        let delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        delay = Math.min(delay, MAX_RETRY_DELAY_MS);

        console.warn(
          `[Util NFTGO Fetch WARN] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed for ${contractAddress}. Status: ${status || 'N/A'}. Message: ${error.message}`
        );

        if (status === 429) {
          let waitTime = delay;
          if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
            waitTime = Math.max(delay, Number(retryAfterHeader) * 1000 + 200);
          }
          if (attempt < MAX_RETRIES) {
            console.log(
              `   Rate limit hit. Retrying after ${waitTime / 1000}s...`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }
        } else if (status === 404) {
          console.warn(
            `   Collection ${contractAddress} not found on NFTGO (404). Returning [].`
          );
          return [];
        } else if (status && status >= 500) {
          // Retry on server errors
          if (attempt < MAX_RETRIES) {
            console.log(
              `   Server error (${status}). Retrying after ${delay / 1000}s...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        } else {
          // Other client errors (400, 401, 403 etc.) or unknown - Throw to caller? Or return []?
          // Let's throw for unexpected client errors here, handled by fetchFloorPriceData
          console.error(
            `   Non-retryable Axios error. Status: ${status || 'N/A'}. Throwing.`
          );
          throw error;
        }
      } else {
        // Non-Axios error - Throw to caller
        console.error(
          `[Util NFTGO Fetch Error] Non-Axios error for ${contractAddress}:`,
          error
        );
        throw error;
      }
      // If loop finishes after max retries on retryable errors
      console.error(
        `[Util NFTGO Fetch Error] Max retries (${MAX_RETRIES}) reached for ${contractAddress}. Returning [].`
      );
    } // End catch
  } // End for loop

  return []; // Return empty if max retries hit
}

/**
 * Fetches floor price from OpenSea API (/listings/collection/{slug}/best) as a fallback.
 */
async function fetchOpenSeaFloorPriceInternal(slug: string): Promise<number> {
  const url = `${OPENSEA_API_BASE}/listings/collection/${slug}/best`;
  console.log(
    `[Util OS Floor Fetch] Attempting fallback for: ${slug} at ${url}`
  );

  if (!OPENSEA_API_KEY) {
    console.error('[Util OS Floor Fetch] OpenSea API Key is missing.');
    // Don't throw, just return 0 as it's a fallback
    return 0;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get<{ listings: OpenseaListing[] }>(url, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': OPENSEA_API_KEY,
        },
        timeout: FETCH_TIMEOUT_MS,
      });

      const floorData = response.data.listings?.[0]?.price?.current?.value;
      if (floorData) {
        try {
          const floorPriceWei = BigInt(floorData);
          const floorPriceEth = Number(floorPriceWei) / 1e18;
          if (!isNaN(floorPriceEth)) {
            console.log(
              `[Util OS Floor Fetch] Success for ${slug}: ${floorPriceEth} ETH`
            );
            return floorPriceEth;
          }
        } catch (e) {
          console.error(
            `[Util OS Floor Fetch] Error parsing price ${floorData} for ${slug}:`,
            e
          );
        }
      }
      console.warn(
        `[Util OS Floor Fetch WARN] Could not determine OpenSea floor price for ${slug}.`
      );
      return 0; // Return 0 if no price found or parsing failed, don't retry
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        let delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        delay = Math.min(delay, MAX_RETRY_DELAY_MS);

        console.warn(
          `[Util OS Floor Fetch WARN] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed for ${slug}. Status: ${status || 'N/A'}. Message: ${error.message}`
        );

        if (status === 429) {
          let waitTime = delay;
          if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
            waitTime = Math.max(delay, Number(retryAfterHeader) * 1000 + 200);
          }
          if (attempt < MAX_RETRIES) {
            console.log(
              `   Rate limit hit. Retrying after ${waitTime / 1000}s...`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }
        } else if (status === 404) {
          console.warn(
            `   OS listings not found (404) for collection ${slug}. Returning 0.`
          );
          return 0; // Return 0 for 404, don't retry
        } else if (status && status >= 500) {
          // Retry on server errors
          if (attempt < MAX_RETRIES) {
            console.log(
              `   Server error (${status}). Retrying after ${delay / 1000}s...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        } else {
          // Other client errors - don't retry fallback
          console.error(
            `   Non-retryable Axios error. Status: ${status || 'N/A'}. Returning 0.`
          );
          return 0;
        }
      } else {
        // Non-Axios error - don't retry fallback
        console.error(
          `[Util OS Floor Fetch Error] Non-Axios error for ${slug}:`,
          error
        );
        return 0;
      }
      // If loop finishes after max retries on retryable errors
      console.error(
        `[Util OS Floor Fetch Error] Max retries (${MAX_RETRIES}) reached for ${slug}. Returning 0.`
      );
    } // End catch
  } // End for loop

  return 0; // Return 0 if max retries hit
}

/**
 * Fetches floor price, trying NFTGO first and falling back to OpenSea.
 */
export async function fetchFloorPriceData(
  contractAddress: string,
  slug: string
): Promise<{ floor_price: number }> {
  try {
    const nftgoPrices = await fetchNFTGOFloorPriceInternal(contractAddress);

    // Prioritize OpenSea price from NFTGO if available
    const nftgoOpenseaPrice = nftgoPrices.find(
      (p) => p.marketplace.toLowerCase() === 'opensea'
    );

    if (nftgoOpenseaPrice && nftgoOpenseaPrice.floor_price > 0) {
      console.log(
        `[Util Fetch Floor] Using NFTGO (OpenSea) floor price for ${contractAddress}: ${nftgoOpenseaPrice.floor_price} ETH`
      );
      return { floor_price: nftgoOpenseaPrice.floor_price };
    }

    // If no specific OpenSea price from NFTGO, use the highest price from NFTGO (if any)
    if (nftgoPrices.length > 0) {
      const highestNftgoPrice = nftgoPrices.reduce(
        (max, p) => (p.floor_price > max ? p.floor_price : max),
        0
      );
      if (highestNftgoPrice > 0) {
        console.log(
          `[Util Fetch Floor] Using highest NFTGO floor price for ${contractAddress}: ${highestNftgoPrice} ETH`
        );
        return { floor_price: highestNftgoPrice };
      }
    }

    // If NFTGO returned no usable data, try OpenSea directly
    console.warn(
      `[Util Fetch Floor] NFTGO data unusable for ${contractAddress}. Falling back to OpenSea for slug ${slug}.`
    );
    const openseaPrice = await fetchOpenSeaFloorPriceInternal(slug);
    return { floor_price: openseaPrice };
  } catch (error) {
    // Catch errors from fetchNFTGOFloorPriceInternal if it threw something other than 404
    // Make this log concise as well
    if (axios.isAxiosError(error)) {
      console.error(
        `[Util Fetch Floor] Error during NFTGO fetch for ${contractAddress} (Status: ${error.response?.status || 'N/A'}, Msg: ${error.message}). Trying OpenSea fallback.`,
        error.response?.data
          ? `| Data: ${JSON.stringify(error.response.data)}`
          : ''
      );
    } else {
      console.error(
        `[Util Fetch Floor] Non-Axios error during NFTGO fetch for ${contractAddress}, trying OpenSea fallback:`,
        error
      );
    }

    // Fallback to OpenSea if NFTGO fetch failed unexpectedly
    try {
      const openseaPrice = await fetchOpenSeaFloorPriceInternal(slug);
      return { floor_price: openseaPrice };
    } catch (fallbackError) {
      console.error(
        `[Util Fetch Floor] OpenSea fallback also failed for ${slug}:`,
        fallbackError
      );
      return { floor_price: 0 }; // Final fallback
    }
  }
}

// Placeholder for the main combined fetcher function
export interface CombinedCollectionData
  extends Omit<BasicCollectionInfo, 'stats'> {
  // Omit nested stats
  floor_price: number;
  // Include flattened stats here
  total_supply: number;
  num_owners: number;
  total_volume: number;
  market_cap: number;
}

export async function fetchCollectionData(
  slug: string,
  contractAddress: string
): Promise<CombinedCollectionData> {
  console.log(
    `[Util Fetch Combined] Fetching all data for ${slug} (${contractAddress})`
  );
  const infoPromise = fetchSingleCollectionInfo(slug);
  const pricePromise = fetchFloorPriceData(contractAddress, slug);

  const [infoResult, priceResult] = await Promise.allSettled([
    infoPromise,
    pricePromise,
  ]);

  // Process results - providing default info if fetch failed
  const info: BasicCollectionInfo =
    infoResult.status === 'fulfilled'
      ? infoResult.value
      : {
          slug: slug,
          name: null,
          description: null,
          image_url: null,
          safelist_status: null,
          total_supply: 0,
          num_owners: 0,
          total_volume: 0,
          market_cap: 0,
        };

  const floor_price =
    priceResult.status === 'fulfilled' ? priceResult.value.floor_price : 0; // Default price if fetch failed

  if (infoResult.status === 'rejected') {
    console.error(
      `[Util Fetch Combined] Failed to fetch basic info for ${slug}:`,
      infoResult.reason
    );
  }
  if (priceResult.status === 'rejected') {
    console.error(
      `[Util Fetch Combined] Failed to fetch floor price for ${contractAddress}/${slug}:`,
      priceResult.reason
    );
  }

  // Construct the flattened CombinedCollectionData
  return {
    slug: info.slug,
    name: info.name,
    description: info.description,
    image_url: info.image_url,
    safelist_status: info.safelist_status,
    floor_price: floor_price,
    // Get stats from the info object
    total_supply: info.total_supply,
    num_owners: info.num_owners,
    total_volume: info.total_volume,
    market_cap: info.market_cap,
  };
}
