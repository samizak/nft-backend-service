import { RawOpenSeaApiResponse, RawOpenSeaEvent, ActivityEvent } from './types';
import ActivityEventModel, { IActivityEvent } from '../../models/ActivityEvent';
import mongoose from 'mongoose';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// --- Constants ---
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const OPENSEA_API_BASE_URL = 'https://api.opensea.io/api/v2';
const OPENSEA_CHAIN = 'ethereum'; // Or load from env if needed
const OPENSEA_EVENT_TYPES = ['sale', 'transfer', 'cancel']; // Add 'cancel' if you want to store them
const OPENSEA_LIMIT = 50; // Max allowed by OpenSea is 50 for V2 account events
const MAX_RETRIES = 5; // Number of retries for rate limits / server errors
const RETRY_DELAY = 5000; // Delay between retries in milliseconds (5 seconds)
const INTER_PAGE_DELAY = 300; // Small delay between fetching pages
const MAX_PAGES_DEFAULT = 20; // Default max pages for background sync

// Helper function to pause execution
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// --- Mapping Logic --- // (Includes transaction/order_hash fallback)
const mapRawEventToActivityEvent = (
  rawEvent: RawOpenSeaEvent | null
): ActivityEvent | null => {
  if (!rawEvent) return null;
  if (
    !rawEvent.event_type ||
    !rawEvent.event_timestamp ||
    !rawEvent.nft ||
    !rawEvent.nft.identifier ||
    !rawEvent.nft.contract ||
    !rawEvent.nft.collection ||
    !rawEvent.nft.display_image_url ||
    !rawEvent.nft.image_url
  ) {
    console.log('Filtering event: Missing essential fields.', {
      raw_event: rawEvent,
    });
    return null;
  }
  let transactionHash = '';
  if (
    rawEvent.transaction &&
    typeof rawEvent.transaction === 'string' &&
    rawEvent.transaction.trim() !== ''
  ) {
    transactionHash = rawEvent.transaction;
  } else if (
    rawEvent.order_hash &&
    typeof rawEvent.order_hash === 'string' &&
    rawEvent.order_hash.trim() !== ''
  ) {
    console.log(
      `Using order_hash (${rawEvent.order_hash}) as fallback for event type ${rawEvent.event_type}`
    );
    transactionHash = rawEvent.order_hash;
  } else if (!rawEvent.transaction && !rawEvent.order_hash) {
    console.log(
      `Warning: Event type ${rawEvent.event_type} missing both transaction and order_hash. Using empty string.`
    );
  }
  let createdTimestamp: number;
  try {
    // Get milliseconds directly from getTime(), no division needed
    createdTimestamp = new Date(rawEvent.event_timestamp).getTime();
    // Handle potential invalid date parsing
    if (isNaN(createdTimestamp)) {
      console.warn(
        `[Event Service] Invalid event_timestamp encountered: ${rawEvent.event_timestamp}. Setting timestamp to 0.`
      );
      createdTimestamp = 0; // Or handle as appropriate, maybe Date.now()?
    }
  } catch (error) {
    console.error(
      `[Event Service] Error parsing event_timestamp: ${rawEvent.event_timestamp}`,
      error
    );
    createdTimestamp = 0; // Default to 0 on error
  }
  const nft: ActivityEvent['nft'] = {
    identifier: rawEvent.nft.identifier,
    collection: rawEvent.nft.collection,
    contract: rawEvent.nft.contract,
    name: rawEvent.nft.name ?? null,
    display_image_url: rawEvent.nft.display_image_url,
    image_url: rawEvent.nft.image_url,
  };
  let fromAddress: string | null | undefined = null;
  let toAddress: string | null | undefined = null;
  switch (rawEvent.event_type) {
    case 'sale':
      fromAddress = rawEvent.seller?.address || (rawEvent as any).seller;
      toAddress = rawEvent.taker?.address || (rawEvent as any).buyer;
      break;
    case 'transfer':
    case 'cancel':
      fromAddress =
        rawEvent.from_account?.address || (rawEvent as any).from_address;
      toAddress = rawEvent.to_account?.address || (rawEvent as any).to_address;
      break;
    default:
      fromAddress = rawEvent.from_account?.address || rawEvent.seller?.address;
      toAddress = rawEvent.to_account?.address || rawEvent.taker?.address;
      if (!fromAddress && !toAddress) {
        console.warn(
          `Filtering event: Unsupported/unmappable event_type (${rawEvent.event_type}) for accounts.`
        );
        return null;
      }
  }
  if (!fromAddress && !toAddress) {
    console.warn(
      `Filtering event (${rawEvent.event_type}): Could not determine from_address OR to_address.`,
      { raw_event: rawEvent }
    );
    return null;
  }
  const fromAccount: ActivityEvent['from_account'] = {
    address: fromAddress || '0x0000000000000000000000000000000000000000',
  };
  const toAccount: ActivityEvent['to_account'] = {
    address: toAddress || '0x0000000000000000000000000000000000000000',
  };
  let payment: ActivityEvent['payment'] | null = null;
  let quantity: ActivityEvent['quantity'] | null = null;
  if (rawEvent.event_type === 'sale') {
    const rawPayment = (rawEvent as any).payment;
    if (
      rawPayment &&
      rawPayment.quantity != null &&
      rawPayment.token_address &&
      rawPayment.decimals != null &&
      rawPayment.symbol
    ) {
      payment = {
        quantity: String(rawPayment.quantity),
        token_address: rawPayment.token_address,
        decimals: String(rawPayment.decimals),
        symbol: rawPayment.symbol,
      };
      const quantityNum = parseInt(
        String(rawEvent.quantity ?? rawPayment.quantity),
        10
      );
      quantity = isNaN(quantityNum) ? 1 : quantityNum;
    } else {
      console.warn(`Filtering sale event: Missing required payment details.`, {
        payment_raw: rawPayment,
      });
      return null;
    }
  } else if (
    rawEvent.event_type === 'transfer' ||
    rawEvent.event_type === 'cancel'
  ) {
    payment = null;
    if (rawEvent.quantity != null) {
      const quantityNum = parseInt(String(rawEvent.quantity), 10);
      if (!isNaN(quantityNum)) quantity = quantityNum;
      else {
        console.warn(
          `Filtering ${rawEvent.event_type} event: Invalid quantity format.`,
          { quantity_raw: rawEvent.quantity }
        );
        return null;
      }
    } else {
      quantity = 1;
    }
  } else {
    payment = null;
    quantity = 1;
  }
  if (quantity === null) {
    console.warn(
      `Filtering event (${rawEvent.event_type}): Quantity validation failed.`
    );
    return null;
  }
  return {
    event_type: rawEvent.event_type,
    created_date: createdTimestamp,
    transaction: transactionHash,
    nft,
    payment: payment ?? undefined,
    from_account: fromAccount,
    to_account: toAccount,
    quantity,
  };
};

// --- NEW: Fetch Paginated Events from DB using Mongoose ---
export const getPaginatedAccountEvents = async (
  address: string,
  skip: number,
  limit: number
): Promise<IActivityEvent[]> => {
  try {
    const lowerCaseAddress = address.toLowerCase();
    // Use Mongoose Model to find events
    const events = await ActivityEventModel.find({
      $or: [
        { 'from_account.address': lowerCaseAddress },
        { 'to_account.address': lowerCaseAddress },
      ],
    })
      .sort({ created_date: -1 }) // Sort by creation date descending
      .skip(skip) // Apply pagination skip
      .limit(limit) // Apply pagination limit
      .lean(); // Use .lean() for plain JS objects if full Mongoose docs aren't needed downstream

    // The model schema ensures lowercase comparison, but explicit lowercase here is safe.
    return events as IActivityEvent[]; // Cast if using lean()
  } catch (error) {
    console.error(
      `[Event Service] Mongoose error fetching paginated events for ${address}:`,
      error
    );
    throw new Error('Failed to retrieve events from database.'); // Keep generic error
  }
};

// --- NEW: Get Total Event Count from DB using Mongoose ---
export const getAccountEventCount = async (
  address: string
): Promise<number> => {
  try {
    const lowerCaseAddress = address.toLowerCase();
    // Use Mongoose Model to count documents
    const count = await ActivityEventModel.countDocuments({
      $or: [
        { 'from_account.address': lowerCaseAddress },
        { 'to_account.address': lowerCaseAddress },
      ],
    });
    return count;
  } catch (error) {
    console.error(
      `[Event Service] Mongoose error counting events for ${address}:`,
      error
    );
    throw new Error('Failed to count events in database.');
  }
};

// In-memory lock to prevent concurrent syncs for the same address
const isSyncing = new Set<string>();

// Export a function to check the sync status
export function checkSyncStatus(address: string): 'syncing' | 'idle' {
  return isSyncing.has(address.toLowerCase()) ? 'syncing' : 'idle';
}

export async function syncAccountEventsInBackground(address: string) {
  const lowerCaseAddress = address.toLowerCase();
  if (isSyncing.has(lowerCaseAddress)) {
    console.log(
      `[Event Service Sync] Sync already in progress for ${lowerCaseAddress}, skipping.`
    );
    return;
  }

  if (!OPENSEA_API_KEY) {
    console.error(
      `[Event Service Sync] OPENSEA_API_KEY is missing or empty. Cannot start sync for ${lowerCaseAddress}.`
    );
    return;
  }

  isSyncing.add(lowerCaseAddress);
  console.log(
    `[Event Service Sync] Starting background sync for ${lowerCaseAddress}...`
  );

  try {
    // --- Restore Core Fetching Logic ---
    let nextCursor: string | null = null;
    let pagesFetched = 0;
    let totalEventsProcessed = 0;
    let rateLimitRetryCount = 0;
    let keepFetching = true;
    const startTime = Date.now();
    const maxPages = MAX_PAGES_DEFAULT;

    // Get the timestamp of the most recent event stored for this account
    const latestEvent = await ActivityEventModel.findOne({
      $or: [
        { 'from_account.address': lowerCaseAddress },
        { 'to_account.address': lowerCaseAddress },
      ],
    })
      .sort({ created_date: -1 })
      .select({ created_date: 1 })
      .lean();

    // Note: API uses occurred_after (seconds), DB uses created_date (ms)
    const occurredAfter = latestEvent
      ? Math.floor(latestEvent.created_date / 1000)
      : null;

    if (occurredAfter) {
      console.log(
        `[Event Service Sync] Found latest event at timestamp ${latestEvent?.created_date}. Fetching events after ${occurredAfter} (seconds).`
      );
    }

    // *** The Main Fetch Loop ***
    while (keepFetching && pagesFetched < maxPages) {
      pagesFetched++;
      console.log(
        `[Event Service Sync] Fetching page ${pagesFetched} ${nextCursor ? 'with cursor ' + nextCursor : ''}`
      );

      try {
        const url = new URL(
          `${OPENSEA_API_BASE_URL}/events/accounts/${lowerCaseAddress}`
        );
        OPENSEA_EVENT_TYPES.forEach((type) =>
          url.searchParams.append('event_type', type)
        );
        url.searchParams.append('limit', String(OPENSEA_LIMIT));
        if (nextCursor) {
          url.searchParams.append('next', nextCursor);
        }
        if (occurredAfter) {
          url.searchParams.append('occurred_after', String(occurredAfter));
        }

        // Make the API call
        const response = await axios.get<RawOpenSeaApiResponse>(
          url.toString(),
          {
            headers: {
              accept: 'application/json',
              'x-api-key': OPENSEA_API_KEY,
            },
            timeout: 15000, // Use FETCH_TIMEOUT_MS constant?
          }
        );

        const rawEvents = response.data.asset_events || [];
        nextCursor = response.data.next || null;
        rateLimitRetryCount = 0; // Reset retries on successful fetch

        if (rawEvents.length === 0) {
          console.log(
            `[Event Service Sync] Page ${pagesFetched}: No more new events returned by API.`
          );
          keepFetching = false;
        } else {
          console.log(
            `[Event Service Sync] Page ${pagesFetched}: Received ${rawEvents.length} raw events.`
          );

          // Map and filter events
          const mappedEvents = rawEvents
            .map(mapRawEventToActivityEvent)
            .filter((e) => e !== null) as ActivityEvent[]; // Filter out nulls
          console.log(
            `[Event Service Sync] Page ${pagesFetched}: Mapped to ${mappedEvents.length} valid activity events.`
          );

          totalEventsProcessed += mappedEvents.length;

          // Use Mongoose bulkWrite for efficient upsert
          if (mappedEvents.length > 0) {
            const bulkOps = mappedEvents.map((event) => ({
              updateOne: {
                filter: {
                  // Define a unique key for upsert
                  transaction: event.transaction,
                  event_type: event.event_type,
                  'nft.identifier': event.nft.identifier,
                  // Add more fields if needed for uniqueness, e.g., log_index
                },
                update: { $set: event },
                upsert: true,
              },
            }));

            console.log(
              `[Event Service Sync] Attempting bulkWrite with ${bulkOps.length} operations...`
            );
            const bulkResult = await ActivityEventModel.bulkWrite(
              bulkOps as any[], // Cast might be needed depending on TS/Mongoose setup
              { ordered: false } // Unordered is faster, continues on error
            );
            console.log(
              `[Event Service Sync] BulkWrite complete. Upserted: ${bulkResult.upsertedCount}, Matched: ${bulkResult.matchedCount}, Modified: ${bulkResult.modifiedCount}`
            );
          }
        }

        // Stop if no next cursor
        if (!nextCursor) {
          console.log(
            `[Event Service Sync] No next cursor provided by API. Ending fetch.`
          );
          keepFetching = false;
        }

        // Add delay between pages if continuing
        if (keepFetching) {
          await sleep(INTER_PAGE_DELAY); // Ensure sleep and INTER_PAGE_DELAY are defined
        }
      } catch (error) {
        // --- Handle Axios errors within the loop ---
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 429 || status === 503 || status === 504) {
            // Rate limit or server unavailable
            rateLimitRetryCount++;
            if (rateLimitRetryCount <= MAX_RETRIES) {
              // Use MAX_RETRIES constant
              const delay = RETRY_DELAY * Math.pow(2, rateLimitRetryCount - 1); // Ensure RETRY_DELAY is defined
              console.warn(
                `[Event Service Sync] Rate limited/server error (Status ${status}) on page ${pagesFetched}. Retrying attempt ${rateLimitRetryCount}/${MAX_RETRIES} after ${delay}ms...`
              );
              await sleep(delay);
              pagesFetched--; // Decrement page counter to retry the same page
            } else {
              console.error(
                `[Event Service Sync] Max retries (${MAX_RETRIES}) exceeded for rate limit/server error on page ${pagesFetched}. Stopping sync.`
              );
              keepFetching = false; // Stop sync
            }
          } else {
            // Other non-retryable Axios error
            console.error(
              `[Event Service Sync] Axios error fetching page ${pagesFetched}: Status ${status || 'N/A'} - ${error.message}`
            );
            keepFetching = false; // Stop sync
          }
        } else {
          // Non-Axios error during page fetch
          console.error(
            `[Event Service Sync] Non-Axios error fetching page ${pagesFetched}:`,
            error
          );
          keepFetching = false; // Stop sync
        }
      } // End catch block for page fetch error
    } // End while loop
    // --- End of Restored Logic ---

    const duration = (Date.now() - startTime) / 1000;
    console.log(
      `[Event Service Sync] Sync finished for ${lowerCaseAddress} in ${duration.toFixed(2)}s. Fetched ${pagesFetched} pages, Processed approx ${totalEventsProcessed} new/updated events.`
    );
  } catch (error) {
    // Catch errors from outside the main loop (e.g., findOne query)
    console.error(
      `[Event Service Sync] Unhandled error during sync process for ${lowerCaseAddress}:`,
      error
    );
  } finally {
    isSyncing.delete(lowerCaseAddress);
    console.log(
      `[Event Service Sync] Released sync lock for ${lowerCaseAddress}.`
    );
  }
}
