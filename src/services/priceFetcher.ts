import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { env } from 'process';

const COINGECKO_API_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,eur,gbp,jpy,aud,cad,cny';
const COINGECKO_API_KEY = env.COINGECKO_API_KEY;
const FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 15 * 1000; // 15 seconds
const MAX_RETRY_DELAY_MS = 10 * 60 * 1000; // 10 minutes

// Default prices used as fallback
const DEFAULT_ETH_PRICES = {
  usd: 3000,
  eur: 2800,
  gbp: 2400,
  jpy: 450000,
  aud: 4500,
  cad: 4100,
  cny: 21000,
};

interface EthPrices {
  usd?: number;
  eur?: number;
  gbp?: number;
  jpy?: number;
  aud?: number;
  cad?: number;
  cny?: number;
  lastUpdated?: Date;
  isDefault?: boolean; // Flag indicating if default prices are used
}

let currentEthPrices: EthPrices = {};
let intervalId: NodeJS.Timeout | null = null;
let retryTimeoutId: NodeJS.Timeout | null = null; // Timeout for scheduled retries
let retryCount = 0;
let isFetching = false; // Prevent concurrent fetches

async function fetchEthPrices(isRetry: boolean = false) {
  if (isFetching && !isRetry) {
    console.log('Price fetch already in progress. Skipping scheduled fetch.');
    return;
  }
  isFetching = true;

  // Clear any pending retry timeout if we are starting a new fetch cycle (not a retry)
  if (!isRetry && retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }

  console.log(
    `Attempting to fetch Ethereum prices... (Attempt: ${retryCount + 1})`
  );
  if (!COINGECKO_API_KEY) {
    console.error(
      'COINGECKO_API_KEY is not set. Using default prices if available or empty.'
    );
    // Only set defaults if no prices (even defaults) exist yet
    if (!currentEthPrices.lastUpdated) {
      currentEthPrices = {
        ...DEFAULT_ETH_PRICES,
        lastUpdated: new Date(),
        isDefault: true,
      };
      console.log('Set default Ethereum prices due to missing API key.');
    }
    isFetching = false;
    return;
  }

  try {
    const response = await axios.get(COINGECKO_API_URL, {
      headers: {
        Accept: 'application/json',
        'x-cg-demo-api-key': COINGECKO_API_KEY,
      },
      // Add a reasonable timeout
      timeout: 15000, // 15 seconds
    });

    if (response.data && response.data.ethereum) {
      currentEthPrices = {
        ...response.data.ethereum,
        lastUpdated: new Date(),
        isDefault: false,
      };
      console.log(
        'Successfully fetched and updated Ethereum prices:',
        currentEthPrices
      );
      retryCount = 0; // Reset retry count on success
    } else {
      console.warn(
        'Received unexpected data format from CoinGecko:',
        response.data
      );
      // Treat unexpected format as an error for retry purposes
      throw new Error('Unexpected data format from CoinGecko');
    }
  } catch (error) {
    let delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
    delay = Math.min(delay, MAX_RETRY_DELAY_MS); // Cap the delay
    let shouldRetry = true;

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      console.error(
        'Axios error fetching Ethereum prices from CoinGecko:',
        status,
        error.response?.statusText,
        error.response?.data || error.message
      );

      // Handle rate limiting (429)
      if (status === 429) {
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        if (retryAfterHeader) {
          const retryAfterSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(retryAfterSeconds)) {
            delay = Math.max(delay, retryAfterSeconds * 1000); // Use server suggested delay if longer
            console.log(
              `Rate limited. Retrying after ${delay / 1000} seconds (from header).`
            );
          } else {
            console.log(
              `Rate limited. Retrying after ${delay / 1000} seconds (calculated backoff).`
            );
          }
        } else {
          console.log(
            `Rate limited. Retrying after ${delay / 1000} seconds (calculated backoff).`
          );
        }
      } else if (status && status >= 400 && status < 500 && status !== 429) {
        // Don't retry on client errors (4xx) other than 429
        console.error(
          'Non-retryable client error occurred. Stopping retries for this cycle.'
        );
        shouldRetry = false;
      }
      // Server errors (5xx) and network errors will use the calculated delay and retry
    } else {
      console.error(
        'An unexpected non-Axios error occurred during price fetch:',
        error
      );
      // Assume transient and retry for non-axios errors too
    }

    if (shouldRetry && retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(
        `Scheduling retry ${retryCount}/${MAX_RETRIES} in ${delay / 1000} seconds...`
      );
      // Clear previous retry timeout if any
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
      retryTimeoutId = setTimeout(() => fetchEthPrices(true), delay);
    } else {
      console.error(
        `Max retries (${MAX_RETRIES}) reached or non-retryable error. Using default prices if available.`
      );
      if (!currentEthPrices.lastUpdated) {
        // Only set defaults if we never got initial prices
        currentEthPrices = {
          ...DEFAULT_ETH_PRICES,
          lastUpdated: new Date(),
          isDefault: true,
        };
        console.log(
          'Set default Ethereum prices after exhausting retries/non-retryable error.'
        );
      } else {
        console.log(
          'Keeping previously fetched prices after exhausting retries/non-retryable error.'
        );
        // Optionally mark existing prices as potentially stale?
        // currentEthPrices.isStale = true;
      }
      retryCount = 0; // Reset for the next scheduled interval
    }
  } finally {
    isFetching = false;
  }
}

export function startPriceFetcher() {
  if (intervalId) {
    console.log('Price fetcher already running.');
    return;
  }

  console.log(
    `Starting Ethereum price fetcher. Interval: ${FETCH_INTERVAL_MS / 1000} seconds.`
  );

  // Fetch immediately on start, respecting isFetching flag
  fetchEthPrices();

  // Then fetch periodically
  intervalId = setInterval(() => {
    // Don't start a new fetch cycle if a retry is already scheduled
    if (!retryTimeoutId) {
      fetchEthPrices();
    } else {
      console.log('Skipping scheduled fetch; a retry is pending.');
    }
  }, FETCH_INTERVAL_MS);
}

export function stopPriceFetcher() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('Stopped Ethereum price fetcher.');
  } else {
    console.log('Price fetcher is not running.');
  }
}

export function getEthPrices(): EthPrices {
  return { ...currentEthPrices };
}
