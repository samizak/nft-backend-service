import axios, { AxiosError } from 'axios';
import { env } from 'process';

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
  pagesFetched: number;
}

const OPENSEA_PAGE_LIMIT = 200;

export const getNftsByAccount = async (
  address: string
): Promise<FetchNftResult> => {
  const apiKey = env.OPENSEA_API_KEY;
  if (!apiKey) {
    console.error('OPENSEA_API_KEY is not set in environment variables.');
    throw new Error('Server configuration error: Missing OpenSea API key.');
  }

  let allNfts: OpenSeaNft[] = [];
  let currentNext: string | null = null;
  let pageCount = 0;
  let hasMore = true;

  console.log(
    `[NFT Fetch] Starting fetch for all NFTs for address: ${address}`
  );

  try {
    do {
      pageCount++;
      const url = new URL(
        `https://api.opensea.io/api/v2/chain/ethereum/account/${address}/nfts`
      );
      url.searchParams.append('limit', OPENSEA_PAGE_LIMIT.toString());
      if (currentNext) {
        url.searchParams.append('next', currentNext);
        console.log(
          `[NFT Fetch] Requesting page ${pageCount} with cursor: ${currentNext}`
        );
      } else {
        console.log(`[NFT Fetch] Requesting page ${pageCount} (first page)`);
      }

      const response = await axios.get<OpenSeaNftResponse>(url.toString(), {
        headers: {
          accept: 'application/json',
          'x-api-key': apiKey,
        },
        timeout: 20000,
      });

      const data = response.data;
      if (data.nfts?.length) {
        allNfts = [...allNfts, ...data.nfts];
        console.log(
          `[NFT Fetch] Fetched ${data.nfts.length} NFTs on page ${pageCount}. Total so far: ${allNfts.length}`
        );
      }

      currentNext = data.next || null;
      hasMore = !!currentNext;
    } while (hasMore);

    console.log(
      `[NFT Fetch] Completed fetch for ${address}. Total NFTs: ${allNfts.length}, Pages Fetched: ${pageCount}`
    );

    return {
      nfts: allNfts,
      pagesFetched: pageCount,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        const status = axiosError.response.status;
        const errorData = axiosError.response.data;
        if (status === 400) {
          console.error(
            `[NFT Fetch Error] OpenSea API Error (Bad Request): Status ${status}, Addr: ${address}, Data: ${JSON.stringify(errorData)}`
          );
          throw new Error(
            `Invalid request for address ${address}: ${JSON.stringify(errorData)}`
          );
        }
        console.error(
          `[NFT Fetch Error] OpenSea API Error: Status ${status}, Addr: ${address}, Data: ${JSON.stringify(errorData)}`
        );
        throw new Error(`Failed to fetch NFTs from OpenSea: Status ${status}`);
      } else if (axiosError.request) {
        console.error(
          `[NFT Fetch Error] OpenSea API Error: No response received. Addr: ${address}`,
          axiosError.code
        );
        throw new Error(
          'Failed to fetch NFTs from OpenSea: No response or timeout.'
        );
      }
    }
    console.error(
      `[NFT Fetch Error] Error fetching NFTs for address ${address}:`,
      error
    );
    throw new Error('An unexpected error occurred while fetching NFTs.');
  }
};
