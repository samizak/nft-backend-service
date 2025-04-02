import { ethers } from 'ethers';
import dotenv from 'dotenv';
// Updated import path for redisClient
import redisClient from '../../lib/redis';

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
}

function getProvider(): ethers.JsonRpcProvider {
  if (!ETH_RPC_URL) {
    throw new Error('Ethereum RPC URL (ETH_RPC_URL) is not configured.');
  }
  return new ethers.JsonRpcProvider(ETH_RPC_URL);
}

export const resolveEnsName = async (name: string): Promise<string | null> => {
  console.log(`[ENS Service] Attempting to resolve ENS name: ${name}`);
  if (!name || !name.includes('.')) {
    console.warn(`[ENS Service] Invalid input provided as ENS name: ${name}`);
    return null;
  }

  const cacheKey = `${CACHE_PREFIX_RESOLVE}${name.toLowerCase()}`;

  try {
    const cachedAddress = await redisClient.get(cacheKey);
    if (cachedAddress) {
      console.log(
        `[ENS Service Cache HIT] Resolved ${name} to address: ${cachedAddress} from cache.`
      );
      return cachedAddress === 'null' ? null : cachedAddress;
    }
    console.log(`[ENS Service Cache MISS] for name: ${name}`);

    const provider = getProvider();
    const address = await provider.resolveName(name);

    if (address) {
      console.log(`[ENS Service] Resolved ${name} to address: ${address}`);
      await redisClient.set(cacheKey, address, 'EX', CACHE_TTL_SECONDS);
      console.log(
        `[ENS Service Cache SET] Stored ${name} -> ${address} for ${CACHE_TTL_SECONDS}s`
      );
    } else {
      console.log(`[ENS Service] Could not resolve ENS name: ${name}`);
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

  const normalizedAddress = address.toLowerCase();
  const cacheKey = `${CACHE_PREFIX_LOOKUP}${normalizedAddress}`;

  try {
    const cachedName = await redisClient.get(cacheKey);
    if (cachedName) {
      console.log(
        `[ENS Service Cache HIT] Looked up ${address} to name: ${cachedName} from cache.`
      );
      return cachedName === 'null' ? null : cachedName;
    }
    console.log(`[ENS Service Cache MISS] for address: ${address}`);

    const provider = getProvider();
    const name = await provider.lookupAddress(normalizedAddress);

    if (name) {
      console.log(`[ENS Service] Looked up ${address} to name: ${name}`);
      await redisClient.set(cacheKey, name, 'EX', CACHE_TTL_SECONDS);
      console.log(
        `[ENS Service Cache SET] Stored ${address} -> ${name} for ${CACHE_TTL_SECONDS}s`
      );
    } else {
      console.log(
        `[ENS Service] Could not lookup ENS name for address: ${address}`
      );
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
