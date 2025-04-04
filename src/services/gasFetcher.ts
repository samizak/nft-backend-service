import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { env } from 'process';
import { ethers } from 'ethers';

const INFURA_API_KEY = env.INFURA_API_KEY;
const INFURA_URL = INFURA_API_KEY
  ? `https://mainnet.infura.io/v3/${INFURA_API_KEY}`
  : '';
const FETCH_INTERVAL_MS = 60 * 1000;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 5 * 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

const DEFAULT_GAS_PRICE_WEI_HEX = '0x4A817C800';

interface GasPriceData {
  gasPrices: {
    currentGasPrice: number;
  };
  timestamp: string;
  isDefault: boolean;
}

let currentGasPriceData: GasPriceData | undefined = undefined;

let intervalId: NodeJS.Timeout | null = null;
let retryTimeoutId: NodeJS.Timeout | null = null;
let retryCount = 0;
let isFetching = false;

function weiHexToGwei(weiHex: string): number {
  try {
    const weiBigNumber = ethers.toBigInt(weiHex);

    // Use ethers.formatUnits to get a fractional Gwei string
    const gweiString = ethers.formatUnits(weiBigNumber, 'gwei');
    // Parse the string into a floating-point number
    return parseFloat(gweiString);
  } catch (e) {
    console.error(`Error converting Wei hex ${weiHex} to Gwei:`, e);

    return NaN;
  }
}

function setDefaultGasPriceData() {
  const defaultGwei = weiHexToGwei(DEFAULT_GAS_PRICE_WEI_HEX);
  currentGasPriceData = {
    gasPrices: {
      currentGasPrice: defaultGwei,
    },
    timestamp: new Date().toISOString(),
    isDefault: true,
  };
  console.log(
    'Set default gas price data:',
    JSON.stringify(currentGasPriceData)
  );
}

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
    if (!currentGasPriceData) {
      setDefaultGasPriceData();
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
      const gasPriceWeiHex = response.data.result;
      const currentGwei = weiHexToGwei(gasPriceWeiHex);

      if (!isNaN(currentGwei)) {
        currentGasPriceData = {
          gasPrices: {
            currentGasPrice: currentGwei,
          },
          timestamp: new Date().toISOString(),
          isDefault: false,
        };
        console.log(
          `[Gas Service] Updated gas price: ${currentGwei.toFixed(3)} Gwei, LastUpdated: ${currentGasPriceData.timestamp}`
        );
        retryCount = 0;
      } else {
        console.error('Failed to convert fetched gas price to Gwei.');
        throw new Error('Gas price conversion failed');
      }
    } else {
      console.warn(
        'Received unexpected data format from Infura:',
        response.data
      );
      throw new Error('Unexpected data format from Infura');
    }
  } catch (error: any) {
    // Declare retry variables outside the conditional blocks
    let delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
    delay = Math.min(delay, MAX_RETRY_DELAY_MS);
    let shouldRetry = true; // Assume retry unless explicitly set to false

    console.error(
      `[Gas Service] Error fetching gas price (Attempt ${retryCount + 1}):`
    );
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      console.error(
        ` > Axios Error: Status ${status || 'N/A'}, Message: ${error.message}`,
        error.response?.data
          ? `| Data: ${JSON.stringify(error.response.data)}`
          : ''
      );

      if (status === 429) {
        // Handle Rate Limit
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        if (retryAfterHeader) {
          const retryAfterSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(retryAfterSeconds)) {
            delay = Math.max(delay, retryAfterSeconds * 1000);
            console.warn(
              `   Retrying after ${delay / 1000}s (from Retry-After header).`
            );
          } else {
            console.warn(
              `   Retrying after ${delay / 1000}s (exponential backoff - invalid Retry-After).`
            );
          }
        } else {
          console.warn(
            `   Retrying after ${delay / 1000}s (exponential backoff - no Retry-After).`
          );
        }
        shouldRetry = true;
      } else if (status && status >= 400 && status < 500) {
        // Non-retryable client error
        console.error('   Non-retryable client error received.');
        shouldRetry = false;
      } else {
        // Server errors (5xx) or other connection issues - rely on default exponential backoff
        console.warn(
          `   Retrying after ${delay / 1000}s (exponential backoff - server/network error).`
        );
        shouldRetry = true;
      }
    } else {
      console.error(` > Non-Axios Error: ${error.message || error}`);
      // Decide if non-axios errors are retryable - assuming yes for now with backoff
      console.warn(
        `   Retrying after ${delay / 1000}s (exponential backoff - non-axios error).`
      );
      shouldRetry = true;
    }

    // Schedule retry or use fallback
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
      if (!currentGasPriceData) {
        setDefaultGasPriceData();
      } else {
        console.log(
          'Keeping previously fetched gas price data after exhausting retries/non-retryable error.'
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

export function getGasPrice(): Readonly<GasPriceData> | undefined {
  return currentGasPriceData
    ? JSON.parse(JSON.stringify(currentGasPriceData))
    : undefined;
}
