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
  nextCursor: string | null;
}

const OPENSEA_PAGE_LIMIT = 200;

export const getNftsByAccount = async (
  address: string,
  nextCursor: string | null = null
): Promise<FetchNftResult> => {
  const apiKey = env.OPENSEA_API_KEY;
  if (!apiKey) {
    console.error('OPENSEA_API_KEY is not set in environment variables.');
    throw new Error('Server configuration error: Missing OpenSea API key.');
  }

  console.log(
    `[NFT Fetch] Fetching page for address: ${address}${nextCursor ? ', Cursor: ' + nextCursor : ''}`
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
      timeout: 20000,
    });

    const data = response.data;
    const fetchedNfts = data.nfts || [];
    const next = data.next || null;

    console.log(
      `[NFT Fetch] Fetched ${fetchedNfts.length} NFTs for ${address}${nextCursor ? ' (cursor: ' + nextCursor + ')' : ' (first page)'}. Next cursor: ${next}`
    );

    return {
      nfts: fetchedNfts,
      nextCursor: next,
    };
  } catch (error) {
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
