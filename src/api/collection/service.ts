import pLimit from 'p-limit';
import { CollectionResult, BatchCollectionsResponse } from './types';

// Import the new utility function and its return type
import {
  fetchCollectionData as fetchCollectionDataUtil,
  CombinedCollectionData,
  BasicCollectionInfo,
} from '../../utils/collectionApi';

const MAX_CONCURRENT_REQUESTS = 5;

// Define the structure for the API response item
interface CollectionResponseItem {
  info: BasicCollectionInfo | null;
  price: { floor_price: number } | null;
}

// --- Main API Service Logic ---

// Updated processCollection to return the new structure
async function processCollection(
  slug: string,
  contractAddress: string
): Promise<CollectionResponseItem | null> {
  console.log(
    `[API Service] Processing collection via util: ${slug} (${contractAddress})`
  );
  try {
    // Call the centralized utility function
    const combinedData: CombinedCollectionData = await fetchCollectionDataUtil(
      slug,
      contractAddress
    );

    // Separate info and price parts
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
    // Create price object only if floor_price is valid (e.g., > 0, adjust as needed)
    const priceData =
      combinedData.floor_price > 0
        ? { floor_price: combinedData.floor_price }
        : null;

    return { info: infoData, price: priceData };
  } catch (error) {
    console.error(
      `[API Service] Error fetching collection data for ${slug} using util:`,
      error
    );
    // Indicate failure by returning null or a specific error structure if preferred
    return null;
  }
}

// Main exported function called by the controller
export async function fetchBatchCollectionData(
  slugs: string[],
  contractAddresses: string[]
): Promise<BatchCollectionsResponse> {
  if (slugs.length === 0) {
    return { data: {} };
  }

  const limit = pLimit(MAX_CONCURRENT_REQUESTS);
  // Adjust the type of the results accumulator
  const results: Record<string, CollectionResponseItem | {}> = {}; // Use {} for failed/empty cases

  const tasks = slugs.map((slug, index) => {
    const contractAddress = contractAddresses[index];
    return limit(() => processCollection(slug, contractAddress));
  });

  const taskResults = await Promise.allSettled(tasks);

  taskResults.forEach((result, index) => {
    const slug = slugs[index];
    if (result.status === 'fulfilled' && result.value) {
      // Successfully processed, store the { info, price } object
      results[slug] = result.value;
    } else {
      // Failed to process or processCollection returned null
      console.warn(
        `[API Service] Failed to get data for slug: ${slug}. Reason:`,
        result.status === 'rejected'
          ? result.reason
          : 'Processing returned null'
      );
      // Store an empty object to indicate failure for this slug
      results[slug] = {};
    }
  });

  console.log('[API Service] Finished processing all collections.');
  console.log('[API Service] Final Results:', results);

  // The structure here now matches Record<string, { info?, price? } | {}>
  // This might require updating BatchCollectionsResponse type definition later
  return { data: results };
}
