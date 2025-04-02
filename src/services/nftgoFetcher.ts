import axios, { AxiosError } from 'axios';
import { env } from 'process';
import redisClient from '../lib/redis';

const NFTGO_API_KEY = env.NFTGO_API_KEY;
const NFTGO_API_BASE = 'https://data-api.nftgo.io/eth/v1';
const CACHE_PREFIX = 'nftgo:floor-price:';
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour cache
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;

interface NFTGOFloorPrice {
  marketplace: string;
  floor_price: number;
  currency: string;
  timestamp: number;
}

interface NFTGOFloorPriceResponse {
  collection_floor_price_list: NFTGOFloorPrice[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchNFTGOFloorPrice(
  contractAddress: string
): Promise<NFTGOFloorPrice[]> {
  if (!NFTGO_API_KEY) {
    throw new Error('NFTGO_API_KEY is not set in environment variables');
  }

  // Validate contract address
  if (!contractAddress.startsWith('0x') || contractAddress.length !== 42) {
    throw new Error(
      'Invalid contract address format. Expected 42-character hex string starting with 0x'
    );
  }

  const cacheKey = `${CACHE_PREFIX}${contractAddress.toLowerCase()}`;

  // Check cache first
  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      const parsedData: NFTGOFloorPrice[] = JSON.parse(cachedData);
      if (Array.isArray(parsedData) && parsedData.length > 0) {
        return parsedData;
      }
    }
  } catch (error) {
    console.error(
      `[NFTGO Cache] Error reading cache for ${contractAddress}:`,
      error
    );
  }

  let retryCount = 0;
  let lastError: Error | null = null;

  while (retryCount < MAX_RETRIES) {
    try {
      console.log(
        `[NFTGO Fetch] Attempting to fetch floor price for:`,
        contractAddress
      );
      const response = await axios.get<NFTGOFloorPriceResponse>(
        `${NFTGO_API_BASE}/marketplace/${contractAddress}/floor-price`,
        {
          headers: {
            accept: 'application/json',
            'X-API-KEY': NFTGO_API_KEY,
          },
          timeout: FETCH_TIMEOUT_MS,
        }
      );

      console.log(`[NFTGO Fetch] Raw API Response:`, {
        status: response.status,
        headers: response.headers,
        data: response.data,
      });

      const floorPrices = response.data.collection_floor_price_list || [];
      console.log(
        `[NFTGO Fetch] Successfully fetched floor prices for ${contractAddress}:`,
        floorPrices
      );

      // Cache the results
      try {
        await redisClient.set(
          cacheKey,
          JSON.stringify(floorPrices),
          'EX',
          CACHE_TTL_SECONDS
        );
      } catch (cacheError) {
        console.error(
          `[NFTGO Cache] Error caching floor price for ${contractAddress}:`,
          cacheError
        );
      }

      return floorPrices;
    } catch (error) {
      lastError = error as Error;
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        console.error(`[NFTGO Fetch] API Error:`, {
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          headers: axiosError.response?.headers,
          data: axiosError.response?.data,
          message: axiosError.message,
          config: {
            url: axiosError.config?.url,
            headers: axiosError.config?.headers,
          },
        });

        if (axiosError.response?.status === 429) {
          const retryAfter = parseInt(
            axiosError.response.headers['retry-after'] || '5'
          );
          await sleep(retryAfter * 1000);
        } else if (axiosError.response && axiosError.response.status >= 500) {
          await sleep(INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount));
        } else {
          throw error;
        }
      } else {
        console.error(`[NFTGO Fetch] Non-API Error:`, error);
        await sleep(INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount));
      }
      retryCount++;
    }
  }

  if (retryCount === MAX_RETRIES && lastError) {
    console.error(
      `[NFTGO Fetch] Failed to fetch floor price after ${MAX_RETRIES} retries:`,
      lastError
    );
    throw lastError;
  }

  return [];
}
