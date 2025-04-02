import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const ALCHEMY_NFT_API_BASE = 'https://eth-mainnet.g.alchemy.com/nft/v3';
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
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

// Floor price data structure from Alchemy
interface AlchemyFloorPriceResponse {
  openSea?: {
    floorPrice?: number; // Price in ETH
    priceCurrency?: string;
    collectionUrl?: string;
  };
  looksRare?: {
    floorPrice?: number; // Price in ETH
    priceCurrency?: string;
    collectionUrl?: string;
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
          let waitTime = delay; // Default exponential backoff delay
          if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
            const headerWaitMs = Number(retryAfterHeader) * 1000 + 200; // Header delay + buffer
            // Take the max of calculated backoff and header, but cap at 25 seconds
            waitTime = Math.min(Math.max(delay, headerWaitMs), 25000); // Cap at 25000 ms
          }
          if (attempt < MAX_RETRIES) {
            console.log(
              `   Rate limit hit (OS Info). Retrying after ${waitTime / 1000}s... (Header was: ${retryAfterHeader ?? 'N/A'})`
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
 * Fetches floor price from Alchemy NFT API.
 * Exported for direct use by the dedicated API endpoint.
 */
export async function fetchAlchemyFloorPriceInternal(
  contractAddress: string
): Promise<number> {
  if (!ALCHEMY_API_KEY) {
    console.error('[Util Alchemy Fetch] API key is missing!');
    return 0; // Cannot proceed without key
  }

  const url = `${ALCHEMY_NFT_API_BASE}/${ALCHEMY_API_KEY}/getFloorPrice?contractAddress=${contractAddress.toLowerCase()}`;
  console.log(
    `[Util Alchemy Fetch] Attempting for: ${contractAddress} at ${url}`
  );

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get<AlchemyFloorPriceResponse>(url, {
        headers: {
          Accept: 'application/json',
          // No specific API key header for Alchemy NFT API in URL path format
        },
        timeout: FETCH_TIMEOUT_MS,
      });

      const data = response.data;
      // Prioritize OpenSea floor price if available, then LooksRare
      const osPrice = data?.openSea?.floorPrice;
      const lrPrice = data?.looksRare?.floorPrice;

      if (osPrice && osPrice > 0) {
        console.log(
          `[Util Alchemy Fetch] Success (OpenSea) for ${contractAddress}: ${osPrice} ETH`
        );
        return osPrice;
      } else if (lrPrice && lrPrice > 0) {
        console.log(
          `[Util Alchemy Fetch] Success (LooksRare) for ${contractAddress}: ${lrPrice} ETH`
        );
        return lrPrice;
      } else {
        console.warn(
          `[Util Alchemy Fetch WARN] No valid floor price found in Alchemy response for ${contractAddress}`
        );
        return 0; // No valid price found
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const retryAfterHeader = error.response?.headers?.['retry-after']; // Check if Alchemy uses this
        let delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        delay = Math.min(delay, MAX_RETRY_DELAY_MS);

        console.warn(
          `[Util Alchemy Fetch WARN] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed for ${contractAddress}. Status: ${status || 'N/A'}. Message: ${error.message}`
        );

        if (status === 429) {
          let waitTime = delay;
          // Apply same capping logic, assuming Alchemy might send Retry-After
          if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
            const headerWaitMs = Number(retryAfterHeader) * 1000 + 200;
            waitTime = Math.min(Math.max(delay, headerWaitMs), 25000); // Cap at 25s
          }
          if (attempt < MAX_RETRIES) {
            console.log(
              `   Rate limit hit (Alchemy Floor). Retrying after ${waitTime / 1000}s... (Header was: ${retryAfterHeader ?? 'N/A'})`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }
        } else if (status === 404) {
          // Alchemy might return 200 OK with empty data instead of 404 for unknown contracts
          // We already handle empty data in the success path. If it's a true 404, log it.
          console.warn(
            `   Collection ${contractAddress} not found via Alchemy (404). Returning 0.`
          );
          return 0;
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
          // Other client errors - don't retry
          console.error(
            `   Non-retryable Axios error. Status: ${status || 'N/A'}. Returning 0.`
          );
          return 0;
        }
      } else {
        // Non-Axios error - don't retry
        console.error(
          `[Util Alchemy Fetch Error] Non-Axios error for ${contractAddress}:`,
          error
        );
        return 0;
      }
      // If loop finishes after max retries on retryable errors
      console.error(
        `[Util Alchemy Fetch Error] Max retries (${MAX_RETRIES}) reached for ${contractAddress}. Returning 0.`
      );
    } // End catch
  } // End for loop

  return 0; // Return 0 if max retries hit
}

/**
 * Fetches floor price using the Alchemy API.
 */
export async function fetchFloorPriceData(
  contractAddress: string,
  slug: string // Keep slug for potential future use or logging, though not used in Alchemy call
): Promise<{ floor_price: number }> {
  try {
    // Only call Alchemy now
    const alchemyPrice = await fetchAlchemyFloorPriceInternal(contractAddress);
    return { floor_price: alchemyPrice };
  } catch (error) {
    // This catch block might be less relevant now if fetchAlchemyFloorPriceInternal returns 0 on error
    // But keep it for unexpected throws
    console.error(
      `[Util Fetch Floor] Unexpected error fetching Alchemy floor price for ${contractAddress} (Slug: ${slug}):`,
      error
    );
    return { floor_price: 0 }; // Final fallback
  }
}

// Placeholder for the main combined fetcher function
export interface CombinedCollectionData
  extends Omit<BasicCollectionInfo, 'stats'> {
  floor_price: number;
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
  // Still fetch OpenSea info in parallel
  const infoPromise = fetchSingleCollectionInfo(slug);
  // Fetch floor price using the updated function (which now uses Alchemy)
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
    priceResult.status === 'fulfilled' ? priceResult.value.floor_price : 0;

  if (infoResult.status === 'rejected') {
    console.error(
      `[Util Fetch Combined] Failed to fetch basic info for ${slug}:`,
      infoResult.reason
    );
  }
  if (priceResult.status === 'rejected') {
    // This might be less common now if fetchFloorPriceData's internal call handles errors by returning 0
    console.error(
      `[Util Fetch Combined] Failed during floor price fetch for ${contractAddress}/${slug}:`,
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
