import { env } from 'process';
import axios from 'axios';
import {
  CollectionInfo,
  PriceData,
  CollectionResult,
  BatchCollectionsResponse,
} from './types';

const OPENSEA_API_KEY = env.OPENSEA_API_KEY || '';
const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';

async function fetchCollectionInfo(
  collectionsToFetch: string[]
): Promise<CollectionInfo[]> {
  if (collectionsToFetch.length === 0 || !OPENSEA_API_KEY) {
    return [];
  }

  const url = `${OPENSEA_API_BASE}/collections/batch`;
  console.log(`Fetching collection info for: ${collectionsToFetch.join(', ')}`);

  try {
    const response = await axios.post(
      url,
      { collections: collectionsToFetch },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': OPENSEA_API_KEY,
        },
      }
    );

    const data = response.data;

    if (!data.collections) {
      console.warn('No collections found in OpenSea batch response');
      return [];
    }

    return data.collections.map(
      (collection: any): CollectionInfo => ({
        collection: collection.collection,
        name: collection.name,
        description: collection.description,
        image_url: collection.image_url,
        safelist_status: collection.safelist_request_status,
      })
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        'Failed to fetch collection info:',
        error.response?.status,
        error.response?.statusText,
        error.response?.data || error.message
      );
    } else {
      console.error('Failed to fetch collection info:', error);
    }
    return [];
  }
}

async function fetchFloorPrice(slug: string): Promise<PriceData | null> {
  if (!OPENSEA_API_KEY) {
    return null;
  }

  const url = `${OPENSEA_API_BASE}/listings/collection/${slug}/best`;
  console.log(`Fetching floor price for: ${slug}`);

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': OPENSEA_API_KEY,
      },
    });

    const data = response.data;

    const floorData = data.listings?.[0]?.price?.current?.value;
    let floorPrice = 0;
    if (floorData) {
      floorPrice = parseFloat(floorData) / Math.pow(10, 18);
    }

    return {
      collection: slug,
      floor_price: floorPrice,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.warn(
        `No listings found for collection ${slug}, setting floor to 0.`
      );
      return { collection: slug, floor_price: 0 };
    }

    if (axios.isAxiosError(error)) {
      console.error(
        `Failed to fetch floor price for ${slug}:`,
        error.response?.status,
        error.response?.statusText,
        error.response?.data || error.message
      );
    } else {
      console.error(`Failed to fetch floor price for ${slug}:`, error);
    }
    return null;
  }
}

export async function fetchBatchCollectionData(
  collectionSlugs: string[]
): Promise<BatchCollectionsResponse> {
  const result: { [collectionSlug: string]: CollectionResult } = {};

  const fetchedInfos = await fetchCollectionInfo(collectionSlugs);
  fetchedInfos.forEach((info) => {
    if (!result[info.collection]) {
      result[info.collection] = {};
    }
    result[info.collection].info = info;
  });

  for (const slug of collectionSlugs) {
    const priceData = await fetchFloorPrice(slug);
    if (priceData) {
      if (!result[slug]) {
        result[slug] = {};
      }
      result[slug].price = priceData;
    } else {
      if (!result[slug]) {
        result[slug] = {};
      }
      console.warn(`Could not fetch price for ${slug}`);
    }
  }

  collectionSlugs.forEach((slug) => {
    if (!result[slug]) {
      result[slug] = {};
    }
  });

  return { data: result };
}
