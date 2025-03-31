import axios, { AxiosError } from 'axios';
import { env } from 'process';
import {
  NFTEvent,
  StreamMessage,
  RawOpenSeaEvent,
  EventNftDetail,
  EventPaymentDetail,
  OpenSeaAccount,
} from './types'; // Assuming types.ts is in the same directory

const MAX_PAGES_DEFAULT = 20;
const OPENSEA_LIMIT = 50; // Max limit for OpenSea events endpoint
const RETRY_DELAY = 5000; // 5 seconds delay for rate limit retry
const MAX_RETRIES = 5;
const INTER_PAGE_DELAY = 300;

function mapRawEventToNFTEvent(
  raw: RawOpenSeaEvent,
  walletAddress: string
): NFTEvent {
  const id =
    raw.id ||
    `${raw.transaction?.hash || `tx_${Date.now()}`}-${raw.nft?.identifier || `nft_${Math.random()}`}-${raw.event_timestamp}`;

  let from_account: OpenSeaAccount | null = null;
  let to_account: OpenSeaAccount | null = null;

  if (
    raw.event_type === 'sale' ||
    raw.event_type === 'bid_entered' ||
    raw.event_type === 'bid_cancelled'
  ) {
    from_account = raw.seller || raw.maker || raw.from_account || null;
    to_account = raw.taker || raw.to_account || null;
  } else if (raw.event_type === 'transfer') {
    from_account = raw.from_account || null;
    to_account = raw.to_account || null;
  } else {
    from_account = raw.from_account || null;
    to_account = raw.to_account || null;
  }

  const payment: EventPaymentDetail | null = raw.payment_token
    ? {
        quantity: raw.quantity || null,
        token_address: raw.payment_token.address,
        decimals: raw.payment_token.decimals,
        symbol: raw.payment_token.symbol,
      }
    : raw.payment
      ? {
          quantity: raw.payment.quantity || null,
          token_address: raw.payment.token_address || null,
          decimals: raw.payment.decimals ? Number(raw.payment.decimals) : null,
          symbol: raw.payment.symbol || null,
        }
      : null;

  return {
    id: id,
    event_type: raw.event_type,
    created_date: raw.event_timestamp,
    transactionHash: raw.transaction?.hash || null,
    nft: raw.nft
      ? {
          identifier: raw.nft.identifier || 'N/A',
          collection: raw.nft.collection || 'N/A',
          contract: raw.nft.contract || 'N/A',
          name: raw.nft.name || null,
          display_image_url: raw.nft.display_image_url || null,
          image_url: raw.nft.image_url || null,
        }
      : null,
    payment: payment,
    from_account: from_account,
    to_account: to_account,
    quantity: raw.quantity ? parseInt(raw.quantity, 10) : 1,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function* streamNftEventsByAccount(
  address: string,
  maxPages: number = MAX_PAGES_DEFAULT
): AsyncGenerator<StreamMessage> {
  const apiKey = env.OPENSEA_API_KEY;
  if (!apiKey) {
    console.error('OPENSEA_API_KEY is not set.');
    yield {
      type: 'error',
      error: 'Server configuration error: Missing OpenSea API key.',
      status: 500,
    };
    return;
  }

  let nextCursor: string | null = null;
  let pageCount = 0;
  let totalEventsFetched = 0;
  const startTime = Date.now();
  const effectiveMaxPages = Math.max(1, maxPages);

  try {
    // Initial progress message
    yield {
      type: 'progress',
      message: 'Initializing event fetch...',
      currentPage: 0,
      totalPages: effectiveMaxPages,
      percentage: 0,
      elapsedTime: Date.now() - startTime,
    };

    do {
      const url = new URL(
        `https://api.opensea.io/api/v2/events/accounts/${address}`
      );
      url.searchParams.append('chain', 'ethereum');
      // Fetch relevant event types
      url.searchParams.append('event_type', 'sale');
      url.searchParams.append('event_type', 'transfer');
      url.searchParams.append('event_type', 'cancel'); // Listing cancellations
      url.searchParams.append('event_type', 'bid_entered');
      url.searchParams.append('event_type', 'bid_cancelled');
      url.searchParams.append('limit', OPENSEA_LIMIT.toString());

      if (nextCursor) {
        url.searchParams.append('next', nextCursor);
      }

      const percentage = Math.min(
        Math.round((pageCount / effectiveMaxPages) * 100),
        99
      );
      yield {
        type: 'progress',
        message: `Fetching page ${pageCount + 1} of ~${effectiveMaxPages}...`,
        currentPage: pageCount + 1,
        totalPages: effectiveMaxPages,
        percentage,
        totalEventsSoFar: totalEventsFetched,
        elapsedTime: Date.now() - startTime,
      };

      let attempt = 0;
      let responseData: {
        asset_events: RawOpenSeaEvent[];
        next: string | null;
      } | null = null;
      let requestSuccessful = false;

      while (attempt < MAX_RETRIES && !requestSuccessful) {
        try {
          const response = await axios.get<{
            asset_events: RawOpenSeaEvent[];
            next: string | null;
          }>(url.toString(), {
            headers: {
              accept: 'application/json',
              'X-API-KEY': apiKey,
            },
            timeout: 20000, // 20 seconds timeout
          });
          responseData = response.data;
          requestSuccessful = true;
        } catch (error) {
          attempt++;
          if (
            axios.isAxiosError(error) &&
            error.response?.status === 429 &&
            attempt < MAX_RETRIES
          ) {
            yield {
              type: 'progress',
              message: `Rate limited. Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY / 1000}s...`,
              currentPage: pageCount + 1,
              totalPages: effectiveMaxPages,
              percentage,
              isRateLimited: true,
              retryCount: attempt,
              totalEventsSoFar: totalEventsFetched,
              elapsedTime: Date.now() - startTime,
            };
            await sleep(RETRY_DELAY);
          } else {
            throw error;
          }
        }
      }

      if (!requestSuccessful || !responseData) {
        yield {
          type: 'error',
          error: `Failed to fetch data after ${MAX_RETRIES} attempts (likely rate limit).`,
          status: 429,
        };
        return;
      }

      const rawEvents: RawOpenSeaEvent[] = responseData.asset_events || [];
      const mappedEvents: NFTEvent[] = rawEvents.map((raw) =>
        mapRawEventToNFTEvent(raw, address)
      );

      totalEventsFetched += mappedEvents.length;
      const updatedPercentage = Math.min(
        Math.round(((pageCount + 1) / effectiveMaxPages) * 100),
        99
      );

      if (mappedEvents.length > 0) {
        yield {
          type: 'chunk',
          events: mappedEvents,
          pageCount: pageCount + 1,
          totalEvents: totalEventsFetched,
          currentPage: pageCount + 1,
          totalPages: effectiveMaxPages,
          percentage: updatedPercentage,
          elapsedTime: Date.now() - startTime,
        };
      }
      // Else: Don't send empty chunks?

      nextCursor = responseData.next || null;
      pageCount++;

      // Add a small delay before fetching the next page
      if (nextCursor && pageCount < effectiveMaxPages) {
        await sleep(INTER_PAGE_DELAY);
      }
    } while (nextCursor && pageCount < effectiveMaxPages);

    yield {
      type: 'complete',
      totalPages: pageCount,
      totalEvents: totalEventsFetched,
      hasMore: nextCursor !== null && pageCount >= effectiveMaxPages,
      percentage: 100,
      elapsedTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error('Error fetching or processing events:', error);
    let status = 500;
    let message = 'An unexpected error occurred during event fetching.';
    let details: any = null;

    if (axios.isAxiosError(error)) {
      status = error.response?.status || 500;
      details = error.response?.data;
      message = `OpenSea API Error: Status ${status}`;
      if (status === 400) {
        message = 'Invalid request to OpenSea (e.g., bad address format).';
      }
    } else if (error instanceof Error) {
      message = error.message;
    }

    yield { type: 'error', error: message, status, details };
  }
}
