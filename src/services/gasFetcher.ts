import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { env } from 'process';

const INFURA_API_KEY = env.INFURA_API_KEY;
const INFURA_URL = INFURA_API_KEY
  ? `https://mainnet.infura.io/v3/${INFURA_API_KEY}`
  : '';
const FETCH_INTERVAL_MS = 60 * 1000; // Fetch every 60 seconds
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 5 * 1000; // 5 seconds
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// Default gas price (e.g., 20 Gwei) in Wei, used as fallback
const DEFAULT_GAS_PRICE_WEI = '0x4A817C800'; // 20 * 10^9

// Gas price is typically returned in Wei (string), store it as such
interface GasPriceInfo {
  gasPriceWei?: string;
  lastUpdated?: Date;
  isDefault?: boolean; // Flag indicating if default price is used
}

let currentGasPrice: GasPriceInfo = {};
let intervalId: NodeJS.Timeout | null = null;
let retryTimeoutId: NodeJS.Timeout | null = null;
let retryCount = 0;
let isFetching = false;

async function fetchGasPrice(isRetry: boolean = false) {
  if (isFetching && !isRetry) {
    console.log(
      'Gas price fetch already in progress. Skipping scheduled fetch.'
    );
    return;
  }
  isFetching = true;

  if (!isRetry && retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }

  console.log(`Attempting to fetch gas price... (Attempt: ${retryCount + 1})`);
  if (!INFURA_URL) {
    console.error(
      'INFURA_API_KEY is not set. Using default gas price if available or empty.'
    );
    if (!currentGasPrice.lastUpdated) {
      currentGasPrice = {
        gasPriceWei: DEFAULT_GAS_PRICE_WEI,
        lastUpdated: new Date(),
        isDefault: true,
      };
      console.log('Set default gas price due to missing API key.');
    }
    isFetching = false;
    return;
  }

  try {
    const response = await axios.post(
      INFURA_URL,
      {
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.result) {
      currentGasPrice = {
        gasPriceWei: response.data.result,
        lastUpdated: new Date(),
        isDefault: false,
      };
      console.log(
        'Successfully fetched and updated gas price:',
        currentGasPrice
      );
      retryCount = 0;
    } else {
      console.warn(
        'Received unexpected data format from Infura:',
        response.data
      );
      throw new Error('Unexpected data format from Infura');
    }
  } catch (error) {
    let delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
    delay = Math.min(delay, MAX_RETRY_DELAY_MS);
    let shouldRetry = true;

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      console.error(
        'Axios error fetching gas price from Infura:',
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
            delay = Math.max(delay, retryAfterSeconds * 1000);
            console.log(
              `Rate limited (Infura). Retrying after ${delay / 1000} seconds (from header).`
            );
          } else {
            console.log(
              `Rate limited (Infura). Retrying after ${delay / 1000} seconds (calculated backoff).`
            );
          }
        } else {
          console.log(
            `Rate limited (Infura). Retrying after ${delay / 1000} seconds (calculated backoff).`
          );
        }
      } else if (status && status >= 400 && status < 500 && status !== 429) {
        console.error(
          'Non-retryable client error occurred with Infura. Stopping retries.'
        );
        shouldRetry = false;
      }
      // Retry on server errors (5xx) or network errors
    } else {
      console.error(
        'An unexpected non-Axios error occurred during gas price fetch:',
        error
      );
    }

    if (shouldRetry && retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(
        `Scheduling gas price retry ${retryCount}/${MAX_RETRIES} in ${delay / 1000} seconds...`
      );
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
      retryTimeoutId = setTimeout(() => fetchGasPrice(true), delay);
    } else {
      console.error(
        `Max retries (${MAX_RETRIES}) reached or non-retryable error for gas price. Using default value if available.`
      );
      if (!currentGasPrice.lastUpdated) {
        // Set defaults only if we never got initial prices
        currentGasPrice = {
          gasPriceWei: DEFAULT_GAS_PRICE_WEI,
          lastUpdated: new Date(),
          isDefault: true,
        };
        console.log(
          'Set default gas price after exhausting retries/non-retryable error.'
        );
      } else {
        console.log(
          'Keeping previously fetched gas price after exhausting retries/non-retryable error.'
        );
      }
      retryCount = 0;
    }
  } finally {
    isFetching = false;
  }
}

export function startGasFetcher() {
  if (intervalId) {
    console.log('Gas price fetcher already running.');
    return;
  }
  console.log(
    `Starting Gas price fetcher. Interval: ${FETCH_INTERVAL_MS / 1000} seconds.`
  );
  fetchGasPrice();
  intervalId = setInterval(() => {
    if (!retryTimeoutId) {
      fetchGasPrice();
    } else {
      console.log('Skipping scheduled gas fetch; a retry is pending.');
    }
  }, FETCH_INTERVAL_MS);
}

export function stopGasFetcher() {
  if (retryTimeoutId) clearTimeout(retryTimeoutId);
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  retryTimeoutId = null;
  console.log('Stopped Gas price fetcher.');
}

export function getGasPrice(): Readonly<GasPriceInfo> {
  return { ...currentGasPrice };
}
