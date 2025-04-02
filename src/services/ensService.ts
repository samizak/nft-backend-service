import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const ETH_RPC_URL = process.env.ETH_RPC_URL;

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

  try {
    const provider = getProvider();
    const address = await provider.resolveName(name);

    if (address) {
      console.log(`[ENS Service] Resolved ${name} to address: ${address}`);
    } else {
      console.log(`[ENS Service] Could not resolve ENS name: ${name}`);
    }
    return address; // Returns null if not resolved
  } catch (error: any) {
    console.error(
      `[ENS Service] Error resolving ENS name ${name}:`,
      error.message || error
    );
    // Don't throw, return null to indicate resolution failure gracefully to the API handler
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

  try {
    const provider = getProvider();
    const name = await provider.lookupAddress(address);

    if (name) {
      console.log(`[ENS Service] Looked up ${address} to name: ${name}`);
    } else {
      console.log(
        `[ENS Service] Could not lookup ENS name for address: ${address}`
      );
    }
    return name; // Returns null if no primary name is set
  } catch (error: any) {
    console.error(
      `[ENS Service] Error looking up address ${address}:`,
      error.message || error
    );
    return null;
  }
};
