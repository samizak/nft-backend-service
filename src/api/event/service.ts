import axios, { AxiosError } from 'axios';
import { env } from 'process';
import {
  ActivityEvent,
  StreamMessage,
  RawOpenSeaEvent,
  OpenSeaAccount,
  OpenSeaUser,
} from './types'; // Assuming types.ts is in the same directory
import { getDb } from '../../lib/db'; // Import getDb
import { Collection } from 'mongodb'; // Import Collection type

const MAX_PAGES_DEFAULT = 20;
const OPENSEA_LIMIT = 50; // Max limit for OpenSea events endpoint
const RETRY_DELAY = 5000; // 5 seconds delay for rate limit retry
const MAX_RETRIES = 5;
const INTER_PAGE_DELAY = 300;

const mapRawEventToActivityEvent = (
  rawEvent: RawOpenSeaEvent | null
): ActivityEvent | null => {
  if (!rawEvent) return null;

  // Basic validation for essential fields
  if (
    !rawEvent.event_type ||
    !rawEvent.event_timestamp ||
    !rawEvent.nft ||
    !rawEvent.nft.identifier ||
    !rawEvent.nft.contract ||
    !rawEvent.nft.collection
  ) {
    console.log('Filtering event: Missing essential fields.', {
      raw_event: rawEvent,
    });
    return null;
  }

  // --- Transaction / Order Hash Fallback Logic --- START
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
    transactionHash = rawEvent.order_hash; // Use order_hash if transaction is missing
  } else {
    console.log(
      `Warning: Event type ${rawEvent.event_type} missing both transaction and order_hash. Using empty string.`
    );
  }
  // --- Transaction / Order Hash Fallback Logic --- END

  // --- NFT Details (Strict Check - Required by ActivityEvent, except name) ---
  if (
    !rawEvent.nft ||
    !rawEvent.nft.identifier ||
    !rawEvent.nft.collection ||
    !rawEvent.nft.contract ||
    !rawEvent.nft.display_image_url || // Required by ActivityEvent
    !rawEvent.nft.image_url // Required by ActivityEvent
  ) {
    console.warn(
      `Filtering event (${rawEvent.event_type}): Missing required NFT fields (identifier, collection, contract, display_image_url, image_url).`,
      { nft: rawEvent.nft }
    );
    return null;
  }

  const nft: ActivityEvent['nft'] = {
    identifier: rawEvent.nft.identifier,
    collection: rawEvent.nft.collection,
    contract: rawEvent.nft.contract,
    name: rawEvent.nft.name ?? null, // Pass name (or null if missing)
    display_image_url: rawEvent.nft.display_image_url,
    image_url: rawEvent.nft.image_url,
  };

  // --- Accounts (Flexible Check - handle object or direct address) ---
  let fromAddress: string | undefined = undefined;
  let toAddress: string | undefined = undefined;
  let fromUser: OpenSeaUser | undefined = undefined;
  let toUser: OpenSeaUser | undefined = undefined;

  // Determine source accounts based on event type and available fields
  switch (rawEvent.event_type) {
    case 'sale':
      // Prefer seller/taker objects if available, fallback to direct addresses
      fromAddress = rawEvent.seller?.address || (rawEvent as any).seller;
      toAddress = rawEvent.taker?.address || (rawEvent as any).buyer; // Note: API uses 'buyer' string sometimes
      fromUser = rawEvent.seller?.user;
      toUser = rawEvent.taker?.user;
      break;
    case 'transfer':
      // Prefer from_account/to_account objects, fallback to direct addresses
      fromAddress =
        rawEvent.from_account?.address || (rawEvent as any).from_address;
      toAddress = rawEvent.to_account?.address || (rawEvent as any).to_address;
      fromUser = rawEvent.from_account?.user;
      toUser = rawEvent.to_account?.user;
      break;
    default:
      console.warn(
        `Filtering event: Unsupported event_type (${rawEvent.event_type}). Cannot map accounts reliably.`
      );
      return null;
  }

  // Validate required addresses were found
  if (!fromAddress || !toAddress) {
    console.warn(
      `Filtering event (${rawEvent.event_type}): Could not determine required from_address OR to_address.`,
      {
        from_addr_found: fromAddress,
        to_addr_found: toAddress,
        raw_event: rawEvent, // Log raw event for debugging
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

  if (rawEvent.event_type === 'sale') {
    // For sales, expect 'payment' object in raw data
    const rawPayment = (rawEvent as any).payment;
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
          { payment_quantity: rawPayment.quantity }
        );
        return null; // Invalid quantity format
      }
    } else {
      console.warn(
        `Filtering sale event: Missing required fields in payment object.`,
        { payment_obj: rawPayment }
      );
      return null; // Missing required payment details
    }
  } else if (rawEvent.event_type === 'transfer') {
    // For transfers, expect top-level 'quantity' (number or string)
    // ActivityEvent requires payment, so transfers might be filtered if payment is null later
    if (rawEvent.quantity !== undefined && rawEvent.quantity !== null) {
      const quantityNum = parseInt(String(rawEvent.quantity), 10); // Coerce to string first
      if (!isNaN(quantityNum)) {
        quantity = quantityNum;
      } else {
        console.warn(
          `Filtering transfer event: Invalid quantity format at top level.`,
          { quantity_raw: rawEvent.quantity }
        );
        return null; // Invalid quantity format
      }
    } else {
      console.warn(
        `Filtering transfer event: Missing quantity at top level.`,
        {}
      );
      return null; // Missing quantity
    }
    // Payment remains null for transfers as it's not present in the raw event
  }

  // --- Final Validation (Check if requirements for ActivityEvent are met) ---
  if (quantity === null) {
    // Should have been caught earlier, but double-check
    console.warn(
      `Filtering event (${rawEvent.event_type}): Quantity validation failed.`
    );
    return null;
  }

  // --- Construct final validated event ---
  return {
    event_type: rawEvent.event_type,
    created_date: rawEvent.event_timestamp,
    transaction: transactionHash,
    nft: nft,
    payment: payment ?? undefined, // Convert null to undefined for optional field
    from_account: final_from_account,
    to_account: final_to_account,
    quantity: quantity, // Now validated to be non-null number
  };
};

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
  let latestStoredTimestamp: number | null = null;

  try {
    // --- Get the timestamp of the latest stored event for this account --- START
    try {
      const db = getDb();
      const collection: Collection<ActivityEvent> =
        db.collection('activityEvents');
      const latestEvent = await collection.findOne(
        {
          $or: [
            { 'from_account.address': address.toLowerCase() }, // Ensure case-insensitivity if needed
            { 'to_account.address': address.toLowerCase() },
          ],
        },
        { sort: { created_date: -1 } } // Get the newest event
      );

      if (latestEvent && typeof latestEvent.created_date === 'number') {
        latestStoredTimestamp = latestEvent.created_date;
        console.log(
          `Found latest stored event timestamp for ${address}: ${latestStoredTimestamp}`
        );
      } else {
        console.log(`No existing events found for ${address}, fetching all.`);
      }
    } catch (dbError) {
      console.error(
        `DB Error fetching latest event timestamp for ${address}:`,
        dbError
      ); // Log error but continue fetching all
      latestStoredTimestamp = null;
    }
    // --- Get the timestamp of the latest stored event for this account --- END

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
      url.searchParams.append('event_type', 'cancel');
      url.searchParams.append('limit', OPENSEA_LIMIT.toString());

      if (nextCursor) {
        url.searchParams.append('next', nextCursor);
      } else if (latestStoredTimestamp !== null) {
        // *** Apply 'after' only on the FIRST request (when nextCursor is null) ***
        url.searchParams.append('after', String(latestStoredTimestamp)); // Use 'after' parameter
        console.log(`Applying 'after' filter: ${latestStoredTimestamp}`); // Update log message
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
            timeout: 40000, // Increased timeout to 40 seconds
          });
          responseData = response.data;
          requestSuccessful = true;
        } catch (error) {
          attempt++;
          const isAxiosError = axios.isAxiosError(error);
          const statusCode = isAxiosError ? error.response?.status : null;
          const shouldRetry =
            (statusCode === 429 || // Rate limit
              (statusCode && statusCode >= 500 && statusCode < 600)) && // Server errors (5xx)
            attempt < MAX_RETRIES;

          if (shouldRetry) {
            yield {
              type: 'progress',
              message: `OpenSea API Error (${statusCode || 'Unknown'}). Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY / 1000}s...`,
              currentPage: pageCount + 1,
              totalPages: effectiveMaxPages,
              percentage,
              isRateLimited: statusCode === 429, // Still indicate if it was specifically rate limit
              retryCount: attempt,
              totalEventsSoFar: totalValidEventsSent,
              elapsedTime: Date.now() - startTime,
            };
            await sleep(RETRY_DELAY);
          } else {
            // If it's not a retryable error or max retries reached, throw it
            throw error;
          }
        }
      }

      if (!requestSuccessful || !responseData) {
        yield {
          type: 'error',
          error: `Failed to fetch data after ${MAX_RETRIES} attempts (API error or rate limit).`,
          status: 429, // Defaulting to 429 as likely reason, but could be 5xx
        };
        return;
      }

      const rawEvents: RawOpenSeaEvent[] = responseData.asset_events || [];

      // --- Map and Filter ---
      const mappedEvents = rawEvents.map(mapRawEventToActivityEvent);
      const validEvents: ActivityEvent[] = mappedEvents.filter(
        (event): event is ActivityEvent => event !== null
      );

      // --- Sort the validated events chronologically (within the batch) --- START
      if (validEvents.length > 0) {
        validEvents.sort((a, b) => {
          // created_date is a string representation of a timestamp
          const timestampA = parseInt(a.created_date, 10);
          const timestampB = parseInt(b.created_date, 10);

          if (isNaN(timestampA) || isNaN(timestampB)) {
            // Handle cases where created_date might not be a valid number string
            console.warn(
              `Sorting warning: Invalid timestamp format encountered (${a.created_date}, ${b.created_date})`
            );
            return 0; // Keep original order relative to each other if parse fails
          }
          return timestampB - timestampA; // Sort descending (newest first)
        });
      }
      // --- Sort the validated events chronologically (within the batch) --- END

      // --- Store Valid Events in MongoDB ---
      if (validEvents.length > 0) {
        try {
          const db = getDb();
          const collection = db.collection<ActivityEvent>('activityEvents');
          // Use ordered: false to continue inserting even if some fail (e.g., duplicate transaction)
          const insertResult = await collection.insertMany(validEvents, {
            ordered: false,
          });
          console.log(
            `Inserted ${insertResult.insertedCount} / ${validEvents.length} events into DB (Page ${pageCount + 1})`
          );
        } catch (dbError: any) {
          // Log DB errors but don't stop the stream for the client
          // Handle duplicate key errors specifically if needed (error code 11000)
          if (dbError.code === 11000) {
            console.warn(
              `DB Warning: Attempted to insert duplicate event(s) (Page ${pageCount + 1}). Some events might already exist.`,
              { code: dbError.code, writeErrors: dbError.writeErrors?.length }
            );
          } else {
            console.error('DB Error inserting events:', dbError);
          }
          // Optionally, you could yield a specific error/warning message to the client here
        }
      }

      totalValidEventsSent += validEvents.length; // Increment count *after* potential DB insert
      const updatedPercentage = Math.min(
        Math.round(((pageCount + 1) / effectiveMaxPages) * 100),
        99
      );

      if (validEvents.length > 0) {
        yield {
          type: 'chunk',
          events: validEvents, // Send the *sorted* valid events
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
      } else if (status >= 500 && status < 600) {
        // Check for 5xx range
        message = 'OpenSea API server error encountered.'; // More specific message
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
