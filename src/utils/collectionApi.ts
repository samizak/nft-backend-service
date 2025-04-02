import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
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

// Placeholder for NFTGO Floor Price Fetcher - to be added next
export async function fetchFloorPriceData(
  contractAddress: string,
  slug: string
): Promise<{ floor_price: number }> {
  // TODO: Implement NFTGO fetch logic here, using contractAddress
  // TODO: Implement OpenSea floor price fetch (using slug) as fallback
  console.warn(
    `[Util Fetch Floor] Fetching floor price for ${contractAddress} / ${slug} - NOT IMPLEMENTED YET`
  );
  return { floor_price: 0 }; // Placeholder
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
