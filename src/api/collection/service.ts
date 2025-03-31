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

async function fetchSingleCollectionInfo(
  slug: string
): Promise<CollectionInfo | null> {
  if (!OPENSEA_API_KEY) {
    return null;
  }
  const url = `${OPENSEA_API_BASE}/collections/${slug}`;
  console.log(`Fetching collection info for: ${slug}`);

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': OPENSEA_API_KEY,
      },
    });

    const collection = response.data;

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
        `Failed to fetch collection info for ${slug}:`,
        error.response?.status,
        error.response?.statusText,
        error.response?.data || error.message
      );
    } else {
      console.error(`Failed to fetch collection info for ${slug}:`, error);
    }
    return null;
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

  const infoPromises = collectionSlugs.map((slug) =>
    fetchSingleCollectionInfo(slug)
  );

  const pricePromises = collectionSlugs.map((slug) => fetchFloorPrice(slug));

  const [infoResults, priceResults] = await Promise.all([
    Promise.allSettled(infoPromises),
    Promise.allSettled(pricePromises),
  ]);

  infoResults.forEach((infoResult, index) => {
    const slug = collectionSlugs[index];
    if (infoResult.status === 'fulfilled' && infoResult.value) {
      if (!result[slug]) {
        result[slug] = {};
      }
      result[slug].info = infoResult.value;
    } else if (infoResult.status === 'rejected') {
      console.warn(
        `Could not fetch info for ${slug}. Reason:`,
        infoResult.reason
      );
      if (!result[slug]) {
        result[slug] = {};
      }
    }
  });

  priceResults.forEach((priceResult, index) => {
    const slug = collectionSlugs[index];
    if (priceResult.status === 'fulfilled' && priceResult.value) {
      if (!result[slug]) {
        result[slug] = {};
      }
      result[slug].price = priceResult.value;
    } else if (priceResult.status === 'rejected') {
      console.warn(
        `Could not fetch price for ${slug}. Reason:`,
        priceResult.reason
      );
      if (!result[slug]) {
        result[slug] = {};
      }
    }
  });

  collectionSlugs.forEach((slug) => {
    if (!result[slug]) {
      result[slug] = {};
    }
  });

  return { data: result };
}
