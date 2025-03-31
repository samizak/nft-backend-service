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
    pagesFetched: number;
}

const MAX_PAGES_DEFAULT = 5;
const OPENSEA_LIMIT = 50;

export const getNftsByAccount = async (
    address: string,
    nextCursor: string | null = null,
    maxPages: number = MAX_PAGES_DEFAULT
): Promise<FetchNftResult> => {

    const apiKey = env.OPENSEA_API_KEY;
    if (!apiKey) {
        console.error('OPENSEA_API_KEY is not set in environment variables.');
        throw new Error('Server configuration error: Missing OpenSea API key.');
    }

    let allNfts: OpenSeaNft[] = [];
    let currentNext = nextCursor;
    let pageCount = 0;
    const effectiveMaxPages = Math.max(1, maxPages);

    try {
        do {
            const url = new URL(`https://api.opensea.io/api/v2/chain/ethereum/account/${address}/nfts`);
            url.searchParams.append('limit', OPENSEA_LIMIT.toString());
            if (currentNext) {
                url.searchParams.append('next', currentNext);
            }

            const response = await axios.get<OpenSeaNftResponse>(url.toString(), {
                headers: {
                    'accept': 'application/json',
                    'x-api-key': apiKey,
                },
                timeout: 15000, // 15 seconds
            });

            const data = response.data;
            if (data.nfts?.length) {
                allNfts = [...allNfts, ...data.nfts];
            }

            currentNext = data.next || null;
            pageCount++;

        } while (currentNext && pageCount < effectiveMaxPages);

        return {
            nfts: allNfts,
            nextCursor: currentNext,
            pagesFetched: pageCount,
        };

    } catch (error) {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
             if (axiosError.response) {
                const status = axiosError.response.status;
                const errorData = axiosError.response.data;
                 if (status === 400) {
                     console.error(`OpenSea API Error (Bad Request): Status ${status}, Data: ${JSON.stringify(errorData)}`);
                     throw new Error(`Invalid request for address ${address}: ${JSON.stringify(errorData)}`);
                 }
                 console.error(`OpenSea API Error: Status ${status}, Data: ${JSON.stringify(errorData)}`);
                 throw new Error(`Failed to fetch NFTs from OpenSea: Status ${status}`);
            } else if (axiosError.request) {
                console.error('OpenSea API Error: No response received.', axiosError.code);
                 throw new Error('Failed to fetch NFTs from OpenSea: No response or timeout.');
            }
        }
        console.error('Error fetching NFTs:', error);
        throw new Error('An unexpected error occurred while fetching NFTs.');
    }
}; 