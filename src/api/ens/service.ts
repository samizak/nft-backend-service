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
  if (!name || !name.includes('.')) {
    console.warn(`[ENS Service] Invalid input provided as ENS name: ${name}`);
    return null;
  }

  const cacheKey = `${CACHE_PREFIX_RESOLVE}${name.toLowerCase()}`;

  try {
    const cachedAddress = await redisClient.get(cacheKey);
    if (cachedAddress) {
      console.log(
        `[ENS Service Cache HIT] Resolve: ${name} -> ${cachedAddress}`
      );
      return cachedAddress === 'null' ? null : cachedAddress;
    }
    console.log(`[ENS Service Cache MISS] Resolve: ${name}`);

    const provider = getProvider();
    const address = await provider.resolveName(name);

    if (address) {
      console.log(`[ENS Service] Resolved: ${name} -> ${address}`);
      await redisClient.set(cacheKey, address, 'EX', CACHE_TTL_SECONDS);
      console.log(`[ENS Service Cache SET] Resolve: ${name}`);
    } else {
      console.log(`[ENS Service] Failed Resolve: ${name}`);
    }
    return address;
  } catch (error: any) {
    console.error(
      `[ENS Service] Error resolving ${name}:`,
      error.message || error
    );
    return null;
  }
};

export const lookupEnsAddress = async (
  address: string
): Promise<string | null> => {
  if (!ethers.isAddress(address)) {
    console.warn(`[ENS Service] Invalid address: ${address}`);
    return null;
  }

  const normalizedAddress = address.toLowerCase();
  const cacheKey = `${CACHE_PREFIX_LOOKUP}${normalizedAddress}`;

  try {
    const cachedName = await redisClient.get(cacheKey);
    if (cachedName) {
      console.log(
        `[ENS Service Cache HIT] Lookup: ${address} -> ${cachedName}`
      );
      return cachedName === 'null' ? null : cachedName;
    }
    console.log(`[ENS Service Cache MISS] Lookup: ${address}`);

    const provider = getProvider();
    const name = await provider.lookupAddress(normalizedAddress);

    if (name) {
      console.log(`[ENS Service] Looked up: ${address} -> ${name}`);
      await redisClient.set(cacheKey, name, 'EX', CACHE_TTL_SECONDS);
      console.log(`[ENS Service Cache SET] Lookup: ${address}`);
    } else {
      console.log(`[ENS Service] Failed Lookup: ${address}`);
    }
    return name;
  } catch (error: any) {
    console.error(
      `[ENS Service] Error looking up ${address}:`,
      error.message || error
    );
    return null;
  }
};
