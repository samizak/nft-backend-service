import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const NFTGO_API_BASE = 'https://data-api.nftgo.io/eth/v1';
const NFTGO_API_KEY = process.env.NFTGO_API_KEY || '';
const FETCH_TIMEOUT_MS = 15000; // 15 seconds

// Define a simpler type for the basic data returned by fetchSingleCollectionInfo
export interface BasicCollectionInfo {
  slug: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  safelist_status: string | null;
  stats: {
    total_supply: number;
    num_owners: number;
    total_volume: number; // Make sure this corresponds to a field OpenSea provides
    market_cap: number; // Make sure this corresponds to a field OpenSea provides
  };
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
  console.log(`[Util Fetch Info] Attempting for: ${slug}`);

  if (!OPENSEA_API_KEY) {
    console.error('[Util Fetch Info] OpenSea API Key is missing.');
    throw new Error('OpenSea API Key is missing.');
  }

  try {
    // Explicitly type the expected response structure from OpenSea
    const response = await axios.get<{ collection: any }>(url, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': OPENSEA_API_KEY,
      },
      timeout: FETCH_TIMEOUT_MS,
    });

    const collection = response.data?.collection;
    if (!collection) {
      console.warn(
        `[Util Fetch Info] No collection data found for slug: ${slug}`
      );
      // Return a default structure consistent with BasicCollectionInfo
      return {
        slug: slug,
        name: null,
        description: null,
        image_url: null,
        safelist_status: null,
        stats: {
          total_supply: 0,
          num_owners: 0,
          total_volume: 0, // Ensure default matches type
          market_cap: 0, // Ensure default matches type
        },
      };
    }

    // Construct the BasicCollectionInfo object safely
    return {
      slug: slug,
      name: collection.name ?? null,
      description: collection.description ?? null,
      image_url: collection.image_url ?? null,
      safelist_status: collection.safelist_request_status ?? null,
      stats: {
        // Ensure these paths exist in the actual OpenSea response
        total_supply: collection.stats?.total_supply ?? 0,
        num_owners: collection.stats?.num_owners ?? 0,
        // Check OpenSea docs/response for correct total_volume and market_cap paths
        total_volume: collection.stats?.total_volume ?? 0,
        market_cap: collection.stats?.market_cap ?? 0,
      },
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `[Util Fetch Info Error] Axios error for ${slug}: ${error.response?.status} ${error.message}`
      );
      // Consider specific handling for 404 or other statuses if needed
      if (error.response?.status === 404) {
        console.warn(`[Util Fetch Info] Collection ${slug} not found (404).`);
        // Return default object for 404 as well
        return {
          slug: slug,
          name: null,
          description: null,
          image_url: null,
          safelist_status: null,
          stats: {
            total_supply: 0,
            num_owners: 0,
            total_volume: 0,
            market_cap: 0,
          },
        };
      }
    } else {
      console.error(
        `[Util Fetch Info Error] Non-Axios error for ${slug}:`,
        error
      );
    }
    // Re-throw other errors to be handled by the caller (worker or API service)
    throw error;
  }
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
  console.log(`[Util NFTGO Fetch] Making request to: ${url}`);

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
        `[Util NFTGO Fetch] Invalid or empty floor price list in response for ${contractAddress}`
      );
      return [];
    }

    const floorPrices = response.data.collection_floor_price_list
      .map((item: any) => ({
        marketplace: item.marketplace_name,
        // Ensure floor_price and value exist and are numbers
        floor_price:
          typeof item.floor_price?.value === 'number'
            ? item.floor_price.value
            : 0,
      }))
      // Filter out entries where floor price couldn't be determined
      .filter((item: NftgoFloorPrice) => item.floor_price > 0);

    console.log(
      `[Util NFTGO Fetch] Processed floor prices for ${contractAddress}:`,
      floorPrices
    );
    return floorPrices;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        console.warn(
          `[Util NFTGO Fetch] No floor price found (404) for ${contractAddress}`
        );
        return []; // Return empty array for 404, not an error
      }
      // Log other Axios errors
      console.error(
        `[Util NFTGO Fetch Error] Axios error for ${contractAddress}:`,
        {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data,
        }
      );
    } else {
      // Log non-Axios errors
      console.error(
        `[Util NFTGO Fetch Error] Non-Axios error for ${contractAddress}:`,
        error
      );
    }
    // Re-throw the error to be caught by the caller
    throw error;
  }
}

/**
 * Fetches floor price from OpenSea API (/listings/collection/{slug}/best) as a fallback.
 */
async function fetchOpenSeaFloorPriceInternal(slug: string): Promise<number> {
  const url = `${OPENSEA_API_BASE}/listings/collection/${slug}/best`;
  console.log(`[Util OS Floor Fetch] Attempting fallback for: ${slug}`);

  if (!OPENSEA_API_KEY) {
    console.error('[Util OS Floor Fetch] OpenSea API Key is missing.');
    throw new Error(
      'OpenSea API Key is missing for fallback floor price fetch.'
    );
  }

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
        // Convert Wei to ETH (assuming 18 decimals)
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
      `[Util OS Floor Fetch] Could not determine OpenSea floor price for ${slug}.`
    );
    return 0; // Return 0 if no price found or parsing failed
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        console.warn(
          `[Util OS Floor Fetch] No listings found (404) for collection ${slug}, setting floor to 0.`
        );
        return 0; // Return 0 for 404
      }
      console.error(
        `[Util OS Floor Fetch Error] Axios error for ${slug}: ${error.response?.status} ${error.message}`
      );
    } else {
      console.error(
        `[Util OS Floor Fetch Error] Non-Axios error for ${slug}:`,
        error
      );
    }
    // Don't throw here, just return 0 as it's a fallback
    return 0;
  }
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
    console.error(
      `[Util Fetch Floor] Error during NFTGO fetch for ${contractAddress}, trying OpenSea fallback:`,
      error
    );
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
export interface CombinedCollectionData extends BasicCollectionInfo {
  floor_price: number;
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

  // Process results - prioritizing info, handling price failure
  const info =
    infoResult.status === 'fulfilled'
      ? infoResult.value
      : ({
          slug: slug,
          name: null,
          description: null,
          image_url: null,
          safelist_status: null,
          stats: {
            total_supply: 0,
            num_owners: 0,
            total_volume: 0,
            market_cap: 0,
          },
        } as BasicCollectionInfo); // Provide default info if fetch failed

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

  return {
    ...info,
    floor_price: floor_price,
  };
}
