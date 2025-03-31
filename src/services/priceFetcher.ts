import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { env } from 'process';

const COINGECKO_API_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,eur,gbp,jpy,aud,cad,cny';
const COINGECKO_API_KEY = env.COINGECKO_API_KEY;
const FETCH_INTERVAL_MS = 5 * 60 * 1000; // Update every 5 minutes

interface EthPrices {
  usd?: number;
  eur?: number;
  gbp?: number;
  jpy?: number;
  aud?: number;
  cad?: number;
  cny?: number;
  lastUpdated?: Date;
}

let currentEthPrices: EthPrices = {};
let intervalId: NodeJS.Timeout | null = null;

async function fetchEthPrices() {
  console.log('Attempting to fetch Ethereum prices from CoinGecko...');
  if (!COINGECKO_API_KEY) {
    console.error(
      'COINGECKO_API_KEY environment variable is not set. Skipping price fetch.'
    );
    return;
  }

  try {
    const response = await axios.get(COINGECKO_API_URL, {
      headers: {
        Accept: 'application/json',
        'x-cg-demo-api-key': COINGECKO_API_KEY,
      },
    });

    if (response.data && response.data.ethereum) {
      currentEthPrices = {
        ...response.data.ethereum,
        lastUpdated: new Date(),
      };
      console.log(
        'Successfully fetched and updated Ethereum prices:',
        currentEthPrices
      );
    } else {
      console.warn(
        'Received unexpected data format from CoinGecko:',
        response.data
      );
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        'Error fetching Ethereum prices from CoinGecko:',
        error.response?.status,
        error.response?.statusText,
        error.response?.data || error.message
      );
    } else {
      console.error('An unexpected error occurred during price fetch:', error);
    }
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

  // Fetch immediately on start
  fetchEthPrices();

  // Then fetch periodically
  intervalId = setInterval(fetchEthPrices, FETCH_INTERVAL_MS);
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
