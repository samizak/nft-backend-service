import { RawOpenSeaApiResponse, RawOpenSeaEvent, ActivityEvent } from './types';
import { getDb } from '../../lib/db';
import { Collection, Document, WithId } from 'mongodb';
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
    createdTimestamp = Math.floor(
      new Date(rawEvent.event_timestamp).getTime() / 1000
    );
    if (isNaN(createdTimestamp)) throw new Error('Invalid date format');
  } catch (e) {
    console.warn(
      `Filtering event (${rawEvent.event_type}): Invalid timestamp format.`,
      { timestamp: rawEvent.event_timestamp, error: e }
    );
    return null;
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

// --- NEW: Fetch Paginated Events from DB ---
export const getPaginatedAccountEvents = async (
  address: string,
  skip: number,
  limit: number
): Promise<WithId<ActivityEvent>[]> => {
  try {
    const db = getDb();
    const collection = db.collection<ActivityEvent>('activityEvents');
    const lowerCaseAddress = address.toLowerCase();
    const events = await collection
      .find(
        {
          $or: [
            { 'from_account.address': lowerCaseAddress },
            { 'to_account.address': lowerCaseAddress },
          ],
        },
        { sort: { created_date: -1 }, skip: skip, limit: limit }
      )
      .toArray();
    return events;
  } catch (error) {
    console.error(
      `Database error fetching paginated events for ${address}:`,
      error
    );
    throw new Error('Failed to retrieve events from database.');
  }
};

// --- NEW: Get Total Event Count from DB ---
export const getAccountEventCount = async (
  address: string
): Promise<number> => {
  try {
    const db = getDb();
    const collection = db.collection<ActivityEvent>('activityEvents');
    const lowerCaseAddress = address.toLowerCase();
    const count = await collection.countDocuments({
      $or: [
        { 'from_account.address': lowerCaseAddress },
        { 'to_account.address': lowerCaseAddress },
      ],
    });
    return count;
  } catch (error) {
    console.error(`Database error counting events for ${address}:`, error);
    throw new Error('Failed to count events in database.');
  }
};

// --- NEW: Background Sync Function ---
let isSyncing = new Set<string>(); // Basic in-memory lock
export const syncAccountEventsInBackground = async (
  address: string,
  maxPages: number = MAX_PAGES_DEFAULT
): Promise<void> => {
  const startTime = Date.now();
  const lowerCaseAddress = address.toLowerCase();
  console.log(`[Sync:${lowerCaseAddress}] Starting background sync...`);
  if (isSyncing.has(lowerCaseAddress)) {
    console.log(
      `[Sync:${lowerCaseAddress}] Sync already in progress. Skipping.`
    );
    return;
  }
  isSyncing.add(lowerCaseAddress);
  try {
    if (!OPENSEA_API_KEY) {
      console.error(`[Sync:${lowerCaseAddress}] OpenSea API key is missing.`);
      return;
    }
    const db = getDb();
    const collection: Collection<ActivityEvent> =
      db.collection('activityEvents');
    let latestStoredTimestamp: number | null = null;
    try {
      const latestEvent = await collection.findOne(
        {
          $or: [
            { 'from_account.address': lowerCaseAddress },
            { 'to_account.address': lowerCaseAddress },
          ],
        },
        { sort: { created_date: -1 } }
      );
      if (latestEvent?.created_date) {
        latestStoredTimestamp = latestEvent.created_date;
        console.log(
          `[Sync:${lowerCaseAddress}] Found latest stored event timestamp: ${latestStoredTimestamp}`
        );
      } else {
        console.log(
          `[Sync:${lowerCaseAddress}] No existing events found, fetching history.`
        );
      }
    } catch (dbError) {
      console.error(
        `[Sync:${lowerCaseAddress}] DB Error fetching latest event timestamp:`,
        dbError
      );
    }
    let nextCursor: string | null = null;
    let pageCount = 0;
    let totalValidEventsFetched = 0;
    const effectiveMaxPages = Math.max(1, maxPages);
    while (
      pageCount < effectiveMaxPages &&
      (nextCursor !== null || pageCount === 0)
    ) {
      let attempt = 0;
      let requestSuccessful = false;
      let responseData: RawOpenSeaApiResponse | null = null;
      while (attempt < MAX_RETRIES && !requestSuccessful) {
        try {
          console.log(
            `[Sync:${lowerCaseAddress}] Fetching page ${pageCount + 1} (Attempt ${attempt + 1})...`
          );
          const url = new URL(
            OPENSEA_API_BASE_URL + `/events/accounts/` + address
          );
          url.searchParams.append('chain', OPENSEA_CHAIN);
          OPENSEA_EVENT_TYPES.forEach((type) =>
            url.searchParams.append('event_type', type)
          );
          url.searchParams.append('limit', OPENSEA_LIMIT.toString());
          if (nextCursor) {
            url.searchParams.append('next', nextCursor);
          } else if (latestStoredTimestamp !== null) {
            url.searchParams.append('after', String(latestStoredTimestamp));
            console.log(
              `[Sync:${lowerCaseAddress}] Applying 'after' filter: ${latestStoredTimestamp}`
            );
          }
          const response = await axios.get<RawOpenSeaApiResponse>(
            url.toString(),
            {
              headers: {
                accept: 'application/json',
                'X-API-KEY': OPENSEA_API_KEY,
              },
              timeout: 40000,
            }
          );
          responseData = response.data;
          requestSuccessful = true;
        } catch (error) {
          attempt++;
          const isAxiosError = axios.isAxiosError(error);
          const statusCode = isAxiosError ? error.response?.status : null;
          const shouldRetry =
            (statusCode === 429 ||
              (statusCode && statusCode >= 500 && statusCode < 600)) &&
            attempt < MAX_RETRIES;
          if (shouldRetry) {
            console.warn(
              `[Sync:${lowerCaseAddress}] OpenSea API Error (${statusCode || 'Unknown'}). Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY / 1000}s...`
            );
            await sleep(RETRY_DELAY);
          } else {
            console.error(
              `[Sync:${lowerCaseAddress}] Failed to fetch page ${pageCount + 1} after ${attempt} attempts. Error:`,
              isAxiosError ? error.message : error
            );
            break;
          }
        }
      }
      if (!requestSuccessful || !responseData) {
        console.error(
          `[Sync:${lowerCaseAddress}] Could not fetch data for page ${pageCount + 1} after ${MAX_RETRIES} attempts. Stopping sync.`
        );
        break;
      }
      const rawEvents = responseData.asset_events || [];
      if (rawEvents.length === 0 && !responseData.next) {
        console.log(
          `[Sync:${lowerCaseAddress}] No more raw events found on page ${pageCount + 1}. Ending fetch loop.`
        );
        nextCursor = null;
      }
      const mappedEvents = rawEvents.map(mapRawEventToActivityEvent);
      const validEvents: ActivityEvent[] = mappedEvents.filter(
        (event): event is ActivityEvent => event !== null
      );
      if (validEvents.length > 0) {
        validEvents.sort((a, b) => b.created_date - a.created_date); // Sort newest first
        totalValidEventsFetched += validEvents.length;
        console.log(
          `[Sync:${lowerCaseAddress}] Page ${pageCount + 1}: Mapped ${validEvents.length} valid events.`
        );
        try {
          const insertResult = await collection.insertMany(validEvents, {
            ordered: false,
          });
          console.log(
            `[Sync:${lowerCaseAddress}] Inserted ${insertResult.insertedCount} new events into DB (Page ${pageCount + 1}).`
          );
        } catch (dbError: any) {
          if (dbError.code === 11000) {
            const we = dbError.writeErrors?.length || 'some';
            const ic = dbError.result?.nInserted || 0;
            console.warn(
              `[Sync:${lowerCaseAddress}] DB Warning: Attempted insert ${we} duplicates (Page ${pageCount + 1}). ${ic} new events inserted.`
            );
          } else {
            console.error(
              `[Sync:${lowerCaseAddress}] DB Error inserting events (Page ${pageCount + 1}):`,
              dbError
            );
          }
        }
      } else {
        console.log(
          `[Sync:${lowerCaseAddress}] Page ${pageCount + 1}: No valid events to insert.`
        );
      }
      nextCursor = responseData.next || null;
      pageCount++;
      if (!nextCursor) {
        console.log(
          `[Sync:${lowerCaseAddress}] No 'next' cursor provided. Ending sync.`
        );
      } else if (pageCount < effectiveMaxPages) {
        await sleep(INTER_PAGE_DELAY);
      }
    }
    console.log(
      `[Sync:${lowerCaseAddress}] Sync finished. Fetched ${pageCount} pages, ${totalValidEventsFetched} valid events. Duration: ${Date.now() - startTime}ms`
    );
  } catch (error) {
    console.error(
      `[Sync:${lowerCaseAddress}] Unexpected error during sync:`,
      error
    );
  } finally {
    isSyncing.delete(lowerCaseAddress);
    console.log(`[Sync:${lowerCaseAddress}] Released sync lock.`);
  }
};
