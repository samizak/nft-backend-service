import { ethers } from 'ethers';

// Ensure RPC_URL is set in your environment variables (.env or .env.local)
const rpcUrl = process.env.INFURA_API_KEY
  ? `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`
  : undefined;

if (!rpcUrl) {
  console.error('Error: INFURA_API_KEY not found in environment variables.');
  // Optionally handle this error more gracefully depending on your application's needs
  // For example, you might throw an error or provide a default provider (not recommended for production)
  process.exit(1); // Exit if the RPC URL isn't configured, as ENS resolution won't work
}

const provider = new ethers.JsonRpcProvider(rpcUrl);

/**
 * Resolves an ENS name to an Ethereum address.
 * @param ensName The ENS name to resolve (e.g., 'vitalik.eth').
 * @returns The resolved Ethereum address or null if not found or an error occurs.
 */
export const resolveEnsName = async (
  ensName: string
): Promise<string | null> => {
  try {
    console.log(`Resolving ENS name: ${ensName}`);
    const address = await provider.resolveName(ensName);
    console.log(`Resolved address for ${ensName}: ${address}`);
    return address;
  } catch (error) {
    console.error(`Error resolving ENS name ${ensName}:`, error);
    return null; // Return null on error or if the name doesn't resolve
  }
};
