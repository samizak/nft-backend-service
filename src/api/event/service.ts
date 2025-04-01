import axios, { AxiosError } from 'axios';
import { env } from 'process';
import {
  ActivityEvent,
  StreamMessage,
  RawOpenSeaEvent,
  OpenSeaAccount,
  OpenSeaUser,
} from './types'; // Assuming types.ts is in the same directory

const MAX_PAGES_DEFAULT = 20;
const OPENSEA_LIMIT = 50; // Max limit for OpenSea events endpoint
const RETRY_DELAY = 5000; // 5 seconds delay for rate limit retry
const MAX_RETRIES = 5;
const INTER_PAGE_DELAY = 300;

function mapRawEventToActivityEvent(
  raw: RawOpenSeaEvent
): ActivityEvent | null {
  // --- Basic Validation ---
  if (!raw.event_type || !raw.event_timestamp) {
    console.warn(
      'Filtering event: Missing basic fields (event_type or timestamp).',
      { event_type: raw.event_type, timestamp: raw.event_timestamp }
    );
    return null;
  }

  // --- Transaction ---
  if (!raw.transaction) {
    console.warn(
      `Filtering event (${raw.event_type}): Missing transaction hash string.`,
      { rawId: raw.id }
    );
    return null;
  }
  const transaction = raw.transaction;

  // --- NFT Details (Strict Check - Required by ActivityEvent, except name) ---
  if (
    !raw.nft ||
    !raw.nft.identifier ||
    !raw.nft.collection ||
    !raw.nft.contract ||
    !raw.nft.display_image_url || // Required by ActivityEvent
    !raw.nft.image_url // Required by ActivityEvent
  ) {
    console.warn(
      `Filtering event (${raw.event_type}): Missing required NFT fields (identifier, collection, contract, display_image_url, image_url).`,
      { rawId: raw.id, nft: raw.nft }
    );
    return null;
  }

  const nft: ActivityEvent['nft'] = {
    identifier: raw.nft.identifier,
    collection: raw.nft.collection,
    contract: raw.nft.contract,
    name: raw.nft.name ?? null, // Pass name (or null if missing)
    display_image_url: raw.nft.display_image_url,
    image_url: raw.nft.image_url,
  };

  // --- Accounts (Flexible Check - handle object or direct address) ---
  let fromAddress: string | undefined = undefined;
  let toAddress: string | undefined = undefined;
  let fromUser: OpenSeaUser | undefined = undefined;
  let toUser: OpenSeaUser | undefined = undefined;

  // Determine source accounts based on event type and available fields
  switch (raw.event_type) {
    case 'sale':
      // Prefer seller/taker objects if available, fallback to direct addresses
      fromAddress = raw.seller?.address || (raw as any).seller;
      toAddress = raw.taker?.address || (raw as any).buyer; // Note: API uses 'buyer' string sometimes
      fromUser = raw.seller?.user;
      toUser = raw.taker?.user;
      break;
    case 'transfer':
      // Prefer from_account/to_account objects, fallback to direct addresses
      fromAddress = raw.from_account?.address || (raw as any).from_address;
      toAddress = raw.to_account?.address || (raw as any).to_address;
      fromUser = raw.from_account?.user;
      toUser = raw.to_account?.user;
      break;
    default:
      console.warn(
        `Filtering event: Unsupported event_type (${raw.event_type}). Cannot map accounts reliably.`,
        { rawId: raw.id }
      );
      return null;
  }

  // Validate required addresses were found
  if (!fromAddress || !toAddress) {
    console.warn(
      `Filtering event (${raw.event_type}): Could not determine required from_address OR to_address.`,
      {
        rawId: raw.id,
        from_addr_found: fromAddress,
        to_addr_found: toAddress,
        raw_event: raw, // Log raw event for debugging
      }
    );
    return null;
  }

  // Build final account objects (required by ActivityEvent)
  const final_from_account: ActivityEvent['from_account'] = {
    address: fromAddress,
    ...(fromUser?.username && { user: { username: fromUser.username } }),
  };
  const final_to_account: ActivityEvent['to_account'] = {
    address: toAddress,
    ...(toUser?.username && { user: { username: toUser.username } }),
  };

  // --- Payment & Quantity (Revised Logic) ---
  let payment: ActivityEvent['payment'] | null = null;
  let quantity: ActivityEvent['quantity'] | null = null;

  if (raw.event_type === 'sale') {
    // For sales, expect 'payment' object in raw data
    const rawPayment = (raw as any).payment;
    if (
      rawPayment &&
      rawPayment.quantity && // Ensure quantity exists and is non-empty string
      rawPayment.token_address &&
      rawPayment.symbol &&
      rawPayment.decimals !== undefined && // Check decimals existence
      rawPayment.decimals !== null
    ) {
      const quantityNum = parseInt(rawPayment.quantity, 10);
      if (!isNaN(quantityNum)) {
        quantity = quantityNum;
        payment = {
          quantity: rawPayment.quantity, // Keep original string format for payment
          token_address: rawPayment.token_address,
          decimals: String(rawPayment.decimals),
          symbol: rawPayment.symbol,
        };
      } else {
        console.warn(
          `Filtering sale event: Invalid quantity format in payment object.`,
          { rawId: raw.id, payment_quantity: rawPayment.quantity }
        );
        return null; // Invalid quantity format
      }
    } else {
      console.warn(
        `Filtering sale event: Missing required fields in payment object.`,
        { rawId: raw.id, payment_obj: rawPayment }
      );
      return null; // Missing required payment details
    }
  } else if (raw.event_type === 'transfer') {
    // For transfers, expect top-level 'quantity' (number or string)
    // ActivityEvent requires payment, so transfers might be filtered if payment is null later
    if (raw.quantity !== undefined && raw.quantity !== null) {
      const quantityNum = parseInt(String(raw.quantity), 10); // Coerce to string first
      if (!isNaN(quantityNum)) {
        quantity = quantityNum;
      } else {
        console.warn(
          `Filtering transfer event: Invalid quantity format at top level.`,
          { rawId: raw.id, quantity_raw: raw.quantity }
        );
        return null; // Invalid quantity format
      }
    } else {
      console.warn(`Filtering transfer event: Missing quantity at top level.`, {
        rawId: raw.id,
      });
      return null; // Missing quantity
    }
    // Payment remains null for transfers as it's not present in the raw event
  }

  // --- Final Validation (Check if requirements for ActivityEvent are met) ---
  if (quantity === null) {
    // Should have been caught earlier, but double-check
    console.warn(
      `Filtering event (${raw.event_type}): Quantity validation failed.`,
      { rawId: raw.id }
    );
    return null;
  }

  // --- Construct final validated event ---
  return {
    event_type: raw.event_type,
    created_date: raw.event_timestamp,
    transaction: transaction,
    nft: nft,
    payment: payment ?? undefined, // Convert null to undefined for optional field
    from_account: final_from_account,
    to_account: final_to_account,
    quantity: quantity, // Now validated to be non-null number
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
  let totalValidEventsSent = 0; // Track events that pass validation
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
      totalEventsSoFar: 0, // Initial count is 0
      elapsedTime: Date.now() - startTime,
    };

    do {
      const url = new URL(
        `https://api.opensea.io/api/v2/events/accounts/${address}`
      );
      url.searchParams.append('chain', 'ethereum');
      url.searchParams.append('event_type', 'sale');
      url.searchParams.append('event_type', 'transfer');
      url.searchParams.append('event_type', 'cancel'); // Keep this? Might fail validation often.
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
        totalEventsSoFar: totalValidEventsSent, // Report valid events sent so far
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
              totalEventsSoFar: totalValidEventsSent,
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

      // --- Map and Filter ---
      const validEvents: ActivityEvent[] = rawEvents
        .map(mapRawEventToActivityEvent) // Map to ActivityEvent | null
        .filter((event): event is ActivityEvent => event !== null); // Filter out nulls

      totalValidEventsSent += validEvents.length; // Increment count with valid events
      const updatedPercentage = Math.min(
        Math.round(((pageCount + 1) / effectiveMaxPages) * 100),
        99
      );

      if (validEvents.length > 0) {
        yield {
          type: 'chunk',
          events: validEvents, // Send only valid events
          pageCount: pageCount + 1,
          totalEvents: totalValidEventsSent, // Report total valid events sent
          currentPage: pageCount + 1,
          totalPages: effectiveMaxPages,
          percentage: updatedPercentage,
          elapsedTime: Date.now() - startTime,
        };
      }

      nextCursor = responseData.next || null;
      pageCount++;

      if (nextCursor && pageCount < effectiveMaxPages) {
        await sleep(INTER_PAGE_DELAY);
      }
    } while (nextCursor && pageCount < effectiveMaxPages);

    yield {
      type: 'complete',
      totalPages: pageCount,
      totalEvents: totalValidEventsSent, // Final count of valid events
      // hasMore logic might need revisiting based on filtering
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
      if (status === 400) {
        message = 'Bad request to OpenSea API.';
      } else if (status === 401 || status === 403) {
        message = 'Invalid or unauthorized OpenSea API key.';
      } else if (status === 429) {
        message = 'Rate limited by OpenSea API after retries.';
      } else if (status >= 500) {
        message = 'OpenSea API server error.';
      }
    }

    yield {
      type: 'error',
      error: message,
      status: status,
      details: details,
    };
  }
}
