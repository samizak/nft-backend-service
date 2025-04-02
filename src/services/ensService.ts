import { ethers } from 'ethers';
import dotenv from 'dotenv';
import redisClient from '../lib/redis'; // Import Redis client

dotenv.config();

const ETH_RPC_URL = process.env.ETH_RPC_URL;

// Cache constants
const CACHE_PREFIX_RESOLVE = 'ens:resolve:';
const CACHE_PREFIX_LOOKUP = 'ens:lookup:';
const CACHE_TTL_SECONDS = 60 * 60 * 24; // Cache for 24 hours

if (!ETH_RPC_URL) {
  console.error(
    'FATAL ERROR: ETH_RPC_URL is not defined in the environment variables.'
  );
  // Optional: Throw error immediately or let provider creation fail?
  // For now, we'll let provider creation fail below if URL is missing.
  // process.exit(1);
}

// Initialize provider - potentially reusing instance?
// For simplicity, creating a new one each time for now.
// Consider creating a singleton instance if this is called frequently.
function getProvider(): ethers.JsonRpcProvider {
  if (!ETH_RPC_URL) {
    throw new Error('Ethereum RPC URL (ETH_RPC_URL) is not configured.');
  }
  // Using JsonRpcProvider for direct connection via URL
  return new ethers.JsonRpcProvider(ETH_RPC_URL);
}

/**
 * Resolves an ENS name (e.g., "vitalik.eth") to its primary Ethereum address.
 * @param name The ENS name to resolve.
 * @returns The Ethereum address (0x...) or null if not found or error occurs.
 */
export const resolveEnsName = async (name: string): Promise<string | null> => {
  console.log(`[ENS Service] Attempting to resolve ENS name: ${name}`);
  if (!name || !name.includes('.')) {
    // Basic check if it looks like a name
    console.warn(`[ENS Service] Invalid input provided as ENS name: ${name}`);
    return null;
  }

  const cacheKey = `${CACHE_PREFIX_RESOLVE}${name.toLowerCase()}`;

  try {
    // 1. Check cache first
    const cachedAddress = await redisClient.get(cacheKey);
    if (cachedAddress) {
      console.log(
        `[ENS Service Cache HIT] Resolved ${name} to address: ${cachedAddress} from cache.`
      );
      // Ensure we return null if cache somehow stored 'null' string, though unlikely
      return cachedAddress === 'null' ? null : cachedAddress;
    }
    console.log(`[ENS Service Cache MISS] for name: ${name}`);

    // 2. Cache miss - perform live lookup
    const provider = getProvider();
    const address = await provider.resolveName(name);

    if (address) {
      console.log(`[ENS Service] Resolved ${name} to address: ${address}`);
      // 3. Store successful lookup in cache
      await redisClient.set(cacheKey, address, 'EX', CACHE_TTL_SECONDS);
      console.log(
        `[ENS Service Cache SET] Stored ${name} -> ${address} for ${CACHE_TTL_SECONDS}s`
      );
    } else {
      console.log(`[ENS Service] Could not resolve ENS name: ${name}`);
      // Optional: Cache null result? Caching negatives can prevent repeated failed lookups.
      // await redisClient.set(cacheKey, 'null', 'EX', CACHE_TTL_SECONDS / 4); // Cache null for shorter time
    }
    return address;
  } catch (error: any) {
    console.error(
      `[ENS Service] Error resolving ENS name ${name}:`,
      error.message || error
    );
    return null;
  }
};

/**
 * Performs a reverse lookup for an Ethereum address to find its primary ENS name.
 * @param address The Ethereum address (0x...).
 * @returns The primary ENS name (e.g., "vitalik.eth") or null if not found or error.
 */
export const lookupEnsAddress = async (
  address: string
): Promise<string | null> => {
  console.log(`[ENS Service] Attempting to lookup address: ${address}`);
  if (!ethers.isAddress(address)) {
    console.warn(
      `[ENS Service] Invalid input provided as Ethereum address: ${address}`
    );
    return null;
  }

  // Use lowercase address for cache key consistency
  const normalizedAddress = address.toLowerCase();
  const cacheKey = `${CACHE_PREFIX_LOOKUP}${normalizedAddress}`;

  try {
    // 1. Check cache
    const cachedName = await redisClient.get(cacheKey);
    if (cachedName) {
      console.log(
        `[ENS Service Cache HIT] Looked up ${address} to name: ${cachedName} from cache.`
      );
      return cachedName === 'null' ? null : cachedName;
    }
    console.log(`[ENS Service Cache MISS] for address: ${address}`);

    // 2. Cache miss - perform live lookup
    const provider = getProvider();
    const name = await provider.lookupAddress(normalizedAddress); // Use normalized address for lookup too

    if (name) {
      console.log(`[ENS Service] Looked up ${address} to name: ${name}`);
      // 3. Store successful lookup in cache
      await redisClient.set(cacheKey, name, 'EX', CACHE_TTL_SECONDS);
      console.log(
        `[ENS Service Cache SET] Stored ${address} -> ${name} for ${CACHE_TTL_SECONDS}s`
      );
    } else {
      console.log(
        `[ENS Service] Could not lookup ENS name for address: ${address}`
      );
      // Optional: Cache null result?
      // await redisClient.set(cacheKey, 'null', 'EX', CACHE_TTL_SECONDS / 4);
    }
    return name;
  } catch (error: any) {
    console.error(
      `[ENS Service] Error looking up address ${address}:`,
      error.message || error
    );
    return null;
  }
};
