import pLimit from 'p-limit';
import { CollectionResult, BatchCollectionsResponse } from './types';

// Import the new utility function and its return type
import {
  fetchCollectionData as fetchCollectionDataUtil,
  CombinedCollectionData,
} from '../../utils/collectionApi';

const MAX_CONCURRENT_REQUESTS = 5;

// --- Main API Service Logic ---

// Helper to adapt the utility function's output to the expected CollectionResult
function adaptUtilDataToResult(
  utilData: CombinedCollectionData
): CollectionResult {
  return {
    collection: utilData.slug,
    floor_price: utilData.floor_price,
    total_supply: utilData.stats.total_supply,
    owner_count: utilData.stats.num_owners,
    total_volume: utilData.stats.total_volume,
    market_cap: utilData.stats.market_cap,
  };
}

// Updated processCollection using the utility function
async function processCollection(
  slug: string,
  contractAddress: string
): Promise<CollectionResult | null> {
  console.log(
    `[API Service] Processing collection via util: ${slug} (${contractAddress})`
  );
  try {
    const combinedData = await fetchCollectionDataUtil(slug, contractAddress);
    return adaptUtilDataToResult(combinedData);
  } catch (error) {
    console.error(
      `[API Service] Error fetching collection data for ${slug} using util:`,
      error
    );
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
  const results: Record<string, CollectionResult> = {};

  const tasks = slugs.map((slug, index) => {
    const contractAddress = contractAddresses[index];
    return limit(() => processCollection(slug, contractAddress));
  });

  const taskResults = await Promise.allSettled(tasks);

  taskResults.forEach((result, index) => {
    const slug = slugs[index];
    if (result.status === 'fulfilled' && result.value) {
      results[slug] = result.value;
    } else {
      console.warn(
        `[API Service] Failed to get data for slug: ${slug}. Reason:`,
        result.status === 'rejected'
          ? result.reason
          : 'Processing returned null'
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
  });

  console.log('[API Service] Finished processing all collections.');
  console.log('[API Service] Final Results:', results);

  return { data: results };
}
