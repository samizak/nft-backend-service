import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { env } from 'process';

const COINGECKO_API_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,eur,gbp,jpy,aud,cad,cny';
const COINGECKO_API_KEY = env.COINGECKO_API_KEY;
const FETCH_INTERVAL_MS = 1 * 60 * 1000;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 5 * 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

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
  isDefault?: boolean;
}

let currentEthPrices: EthPrices = {};
let intervalId: NodeJS.Timeout | null = null;
let retryTimeoutId: NodeJS.Timeout | null = null;
let retryCount = 0;
let isFetching = false;

async function fetchEthPrices(isRetry: boolean = false) {
  if (isFetching && !isRetry) {
    console.log('Price fetch already in progress. Skipping scheduled fetch.');
    return;
  }
  isFetching = true;

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
      timeout: 15000,
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
      retryCount = 0;
    } else {
      console.warn(
        'Received unexpected data format from CoinGecko:',
        response.data
      );
      throw new Error('Unexpected data format from CoinGecko');
    }
  } catch (error) {
    let delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
    delay = Math.min(delay, MAX_RETRY_DELAY_MS);
    let shouldRetry = true;

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      console.error(
        'Axios error fetching Ethereum prices from CoinGecko:',
        status,
        error.response?.statusText,
        error.response?.data || error.message
      );

      if (status === 429) {
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        if (retryAfterHeader) {
          const retryAfterSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(retryAfterSeconds)) {
            delay = Math.max(delay, retryAfterSeconds * 1000);
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
        console.error(
          'Non-retryable client error occurred. Stopping retries for this cycle.'
        );
        shouldRetry = false;
      }
    } else {
      console.error(
        'An unexpected non-Axios error occurred during price fetch:',
        error
      );
    }

    if (shouldRetry && retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(
        `Scheduling retry ${retryCount}/${MAX_RETRIES} in ${delay / 1000} seconds...`
      );
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
      retryTimeoutId = setTimeout(() => fetchEthPrices(true), delay);
    } else {
      console.error(
        `Max retries (${MAX_RETRIES}) reached or non-retryable error. Using default prices if available.`
      );
      if (!currentEthPrices.lastUpdated) {
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
      }
      retryCount = 0;
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

  fetchEthPrices();

  intervalId = setInterval(() => {
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
