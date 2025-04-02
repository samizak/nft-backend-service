import axios, { AxiosError } from 'axios';
import { env } from 'process';
import redisClient from '../../lib/redis'; // Import Redis client

interface OpenSeaNft {
  identifier: string;
  collection: string;
  contract: string;
  token_standard: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  metadata_url: string | null;
}

interface OpenSeaNftResponse {
  nfts: OpenSeaNft[];
  next: string | null;
}

interface FetchNftResult {
  nfts: OpenSeaNft[];
  nextCursor: string | null;
}

const OPENSEA_PAGE_LIMIT = 200;
const NFT_CACHE_PREFIX = 'nft_page:'; // Prefix for NFT page cache keys
const NFT_CACHE_TTL_SECONDS = 5 * 60; // Cache for 5 minutes

export const getNftsByAccount = async (
  address: string,
  nextCursor: string | null = null
): Promise<FetchNftResult> => {
  const apiKey = env.OPENSEA_API_KEY;
  if (!apiKey) {
    console.error('[NFT Service] OPENSEA_API_KEY is not set.');
    throw new Error('Server configuration error: Missing OpenSea API key.');
  }

  // Generate cache key: Use 'first' if cursor is null/empty
  const cursorKeyPart = nextCursor || 'first';
  const cacheKey = `${NFT_CACHE_PREFIX}${address.toLowerCase()}:${cursorKeyPart}`;

  // 1. Check Cache
  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log(`[NFT Cache] HIT for key: ${cacheKey}`);
      try {
        const parsedData: FetchNftResult = JSON.parse(cachedData);
        // Basic validation
        if (parsedData && Array.isArray(parsedData.nfts)) {
          return parsedData;
        } else {
          console.warn(
            `[NFT Cache] Invalid data structure in cache for key ${cacheKey}. Fetching fresh data.`
          );
          // Proceed to fetch if cache data is invalid
        }
      } catch (parseError) {
        console.error(
          `[NFT Cache] Failed to parse cached data for key ${cacheKey}:`,
          parseError
        );
        // Proceed to fetch if cache data is corrupted
      }
    }
    console.log(`[NFT Cache] MISS for key: ${cacheKey}`);
  } catch (redisError) {
    console.error(
      `[NFT Cache] Redis GET error for key ${cacheKey}:`,
      redisError
    );
    // Proceed to fetch if Redis is unavailable, don't fail the request
  }

  // 2. Cache Miss or Redis Error: Fetch from OpenSea
  console.log(
    `[NFT Fetch] Fetching from OpenSea for address: ${address}${nextCursor ? ', Cursor: ' + nextCursor : ' (first page)'}`
  );

  try {
    const url = new URL(
      `https://api.opensea.io/api/v2/chain/ethereum/account/${address}/nfts`
    );
    url.searchParams.append('limit', OPENSEA_PAGE_LIMIT.toString());
    if (nextCursor) {
      url.searchParams.append('next', nextCursor);
    }

    const response = await axios.get<OpenSeaNftResponse>(url.toString(), {
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
      timeout: 20000, // 20 seconds timeout
    });

    const data = response.data;
    const fetchedNfts = data.nfts || [];
    const next = data.next || null;

    const result: FetchNftResult = {
      nfts: fetchedNfts,
      nextCursor: next,
    };

    console.log(
      `[NFT Fetch] Fetched ${result.nfts.length} NFTs for ${address}. Next cursor: ${result.nextCursor}`
    );

    // 3. Store successful fetch in Cache (don't await, fire and forget)
    redisClient
      .set(cacheKey, JSON.stringify(result), 'EX', NFT_CACHE_TTL_SECONDS)
      .then(() => {
        console.log(
          `[NFT Cache] SET successful for key: ${cacheKey} with TTL ${NFT_CACHE_TTL_SECONDS}s`
        );
      })
      .catch((cacheSetError) => {
        console.error(
          `[NFT Cache] Failed to SET cache for key ${cacheKey}:`,
          cacheSetError
        );
      });

    return result; // Return fetched data
  } catch (error) {
    // Error handling logic remains the same
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        const status = axiosError.response.status;
        const errorData = axiosError.response.data;
        const logSuffix = nextCursor ? ` (cursor: ${nextCursor})` : '';
        if (status === 400) {
          console.error(
            `[NFT Fetch Error] OpenSea API Error (Bad Request): Status ${status}, Addr: ${address}${logSuffix}, Data: ${JSON.stringify(errorData)}`
          );
          throw new Error(
            `Invalid request for address ${address}: ${JSON.stringify(errorData)}`
          );
        }
        console.error(
          `[NFT Fetch Error] OpenSea API Error: Status ${status}, Addr: ${address}${logSuffix}, Data: ${JSON.stringify(errorData)}`
        );
        throw new Error(`Failed to fetch NFTs from OpenSea: Status ${status}`);
      } else if (axiosError.request) {
        console.error(
          `[NFT Fetch Error] OpenSea API Error: No response received. Addr: ${address}${nextCursor ? ', Cursor: ' + nextCursor : ''}`,
          axiosError.code
        );
        throw new Error(
          'Failed to fetch NFTs from OpenSea: No response or timeout.'
        );
      }
    }
    console.error(
      `[NFT Fetch Error] Error fetching NFTs page for address ${address}${nextCursor ? ', Cursor: ' + nextCursor : ''}:`,
      error
    );
    throw new Error('An unexpected error occurred while fetching NFTs.');
  }
};
