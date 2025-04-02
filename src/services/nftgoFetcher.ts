import { env } from 'process';
import axios, { AxiosError } from 'axios';
import redisClient from '../lib/redis';

const NFTGO_API_KEY = env.NFTGO_API_KEY || '';
const NFTGO_API_BASE = 'https://data-api.nftgo.io/eth/v1';
const CACHE_PREFIX = 'nftgo:floor-price:';
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour cache
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;

interface FloorPrice {
  marketplace: string;
  floor_price: number;
}

interface CollectionInfo {
  contract_address: string;
  name: string;
  symbol: string;
  total_supply: number;
  owner_count: number;
  total_volume: number;
  floor_price: number;
  market_cap: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchNFTGOCollectionInfo(
  contractAddresses: string[]
): Promise<CollectionInfo[]> {
  if (!NFTGO_API_KEY) {
    throw new Error('NFTGO API key is missing');
  }

  if (!Array.isArray(contractAddresses) || contractAddresses.length === 0) {
    throw new Error('Contract addresses array is required and cannot be empty');
  }

  const url = `${NFTGO_API_BASE}/collection/info`;
  console.log(
    `[NFTGO Fetch] Getting collection info for: ${contractAddresses.join(', ')}`
  );

  try {
    const response = await axios.post(
      url,
      {
        contract_addresses: contractAddresses,
      },
      {
        headers: {
          'X-API-KEY': NFTGO_API_KEY,
          Accept: 'application/json',
        },
        timeout: 10000,
      }
    );

    const data = response.data;
    if (!data || !Array.isArray(data)) {
      throw new Error('Invalid response format from NFTGO');
    }

    return data.map((item) => ({
      contract_address: item.contract_address,
      name: item.name || '',
      symbol: item.symbol || '',
      total_supply: parseInt(item.total_supply) || 0,
      owner_count: parseInt(item.owner_count) || 0,
      total_volume: parseFloat(item.total_volume) || 0,
      floor_price: parseFloat(item.floor_price) || 0,
      market_cap: parseFloat(item.market_cap) || 0,
    }));
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `[NFTGO Fetch Error] Axios error for collections: ${error.response?.status} ${error.message}`
      );
      throw error;
    } else {
      console.error(
        `[NFTGO Fetch Error] Non-Axios error for collections:`,
        error
      );
      throw new Error(
        `Failed to fetch collection info from NFTGO due to non-HTTP error`
      );
    }
  }
}

export async function fetchNFTGOFloorPrice(
  contractAddress: string
): Promise<FloorPrice[]> {
  if (!NFTGO_API_KEY) {
    console.error('[NFTGO Fetch] API key is missing!');
    throw new Error('NFTGO API key is missing');
  }

  const url = `${NFTGO_API_BASE}/marketplace/${contractAddress.toLowerCase()}/floor-price`;
  console.log(`[NFTGO Fetch] Making request to: ${url}`);
  console.log(
    `[NFTGO Fetch] Using API key: ${NFTGO_API_KEY.substring(0, 4)}...`
  );

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': NFTGO_API_KEY,
      },
      timeout: FETCH_TIMEOUT_MS,
    });

    console.log(`[NFTGO Fetch] Response status: ${response.status}`);
    console.log(`[NFTGO Fetch] Response headers:`, response.headers);
    console.log(`[NFTGO Fetch] Full response data:`, response.data);

    if (!response.data) {
      console.error('[NFTGO Fetch] No data in response');
      return [];
    }

    if (!response.data.collection_floor_price_list) {
      console.error('[NFTGO Fetch] No collection_floor_price_list in response');
      return [];
    }

    const floorPrices = response.data.collection_floor_price_list.map(
      (item: any) => {
        console.log(`[NFTGO Fetch] Processing floor price item:`, item);
        return {
          marketplace: item.marketplace_name,
          floor_price: item.floor_price.value || 0,
        };
      }
    );

    console.log(`[NFTGO Fetch] Processed floor prices:`, floorPrices);
    return floorPrices;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[NFTGO Fetch Error] Axios error details:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        headers: error.response?.headers,
        data: error.response?.data,
        message: error.message,
      });

      if (error.response?.status === 404) {
        console.warn(
          `[NFTGO Fetch] No floor price found for ${contractAddress}`
        );
        return [];
      }
      throw error;
    } else {
      console.error(`[NFTGO Fetch Error] Non-Axios error:`, error);
      throw new Error(
        `Failed to fetch floor price for ${contractAddress} due to non-HTTP error`
      );
    }
  }
}
