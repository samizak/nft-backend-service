import axios, { AxiosError } from 'axios';
import { env } from 'process';
import redisClient from '../../lib/redis';

interface OpenSeaAccount {
  address: string;
  username: string | null;
  profile_img_url: string;
}

interface OpenSeaErrorResponse {
  errors?: string[];
}

// --- Constants for Caching ---
const CACHE_PREFIX = 'user:opensea:';
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour TTL

export const getUserProfileFromOpenSea = async (
  id: string
): Promise<OpenSeaAccount> => {
  // Use lowercase for consistency in cache keys, assuming id is typically an address
  const lowerCaseId = id.toLowerCase();
  const cacheKey = `${CACHE_PREFIX}${lowerCaseId}`;

  // 1. Check Cache First
  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log(`[Cache] Hit for user profile: ${lowerCaseId}`);
      try {
        const parsedData: OpenSeaAccount = JSON.parse(cachedData);
        // Basic validation
        if (parsedData && parsedData.address) {
          return parsedData;
        }
        console.warn(
          `[Cache] Invalid data structure in cache for ${cacheKey}. Fetching fresh.`
        );
      } catch (parseError) {
        console.error(
          `[Cache] Failed to parse cached profile for ${cacheKey}:`,
          parseError
        );
        // Proceed to fetch fresh data if parse fails
      }
    } else {
      console.log(`[Cache] Miss for user profile: ${lowerCaseId}`);
    }
  } catch (redisError) {
    console.error(`[Cache] Redis GET error for ${cacheKey}:`, redisError);
    // Proceed to fetch from OpenSea if Redis read fails
  }

  // 2. Cache Miss or Redis Error: Fetch from OpenSea
  const openseaUrl = `https://api.opensea.io/api/v2/accounts/${id}`;
  const apiKey = env.OPENSEA_API_KEY;

  if (!apiKey) {
    console.error('OPENSEA_API_KEY is not set in environment variables.');
    throw new Error('Server configuration error: Missing OpenSea API key.');
  }

  try {
    console.log(`[OpenSea Fetch] Fetching profile for: ${id}`);
    const response = await axios.get<OpenSeaAccount>(openseaUrl, {
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
      timeout: 10000, // 10 seconds
    });

    const profileData = response.data;

    // 3. Cache the successful result from OpenSea
    if (profileData && profileData.address) {
      try {
        const cacheValue = JSON.stringify(profileData);
        await redisClient.set(cacheKey, cacheValue, 'EX', CACHE_TTL_SECONDS);
        console.log(
          `[Cache] Stored profile for ${lowerCaseId} with TTL ${CACHE_TTL_SECONDS}s`
        );
      } catch (redisSetError) {
        console.error(
          `[Cache] Redis SET error for ${cacheKey}:`,
          redisSetError
        );
        // Failed to cache, but proceed with returning data
      }
    } else {
      console.warn(
        `[OpenSea Fetch] Received invalid profile structure for ${id}. Not caching.`
      );
      // Potentially throw an error here if the structure is unexpected despite 200 OK?
      // For now, we'll return it as is, but it won't be cached.
    }

    return profileData;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<OpenSeaErrorResponse>;
      if (axiosError.response) {
        const status = axiosError.response.status;
        const errorData = axiosError.response.data;
        if (
          (status === 400 || status === 404) &&
          errorData?.errors?.some(
            (err: string) =>
              err.includes('not found') ||
              err.includes('Address or username') ||
              err.includes('Account not found')
          )
        ) {
          throw new Error(`UserNotFound: Address ${id} not found on OpenSea.`);
        }
        console.error(
          `OpenSea API Error: Status ${status}, Data: ${JSON.stringify(errorData)}`
        );
        throw new Error(`Failed to fetch data from OpenSea: Status ${status}`);
      } else if (axiosError.request) {
        console.error(
          'OpenSea API Error: No response received.',
          axiosError.request
        );
        throw new Error('Failed to fetch data from OpenSea: No response.');
      }
    }
    console.error('Error fetching user profile:', error);
    throw new Error(
      'An unexpected error occurred while fetching the user profile.'
    );
  }
};
