import { FastifyRequest, FastifyReply } from 'fastify';
import { getEthPrices } from '../../services/priceFetcher';
import { getGasPrice } from '../../services/gasFetcher';

export async function getMarketEthPrices(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const priceData = getEthPrices();

    // Check if essential data is present
    if (
      !priceData ||
      typeof priceData.usd === 'undefined' ||
      !priceData.lastUpdated
    ) {
      // Data not ready yet or fetch failed initially
      request.log.warn('ETH price data not available yet.');
      // Return a specific status or default values
      return reply.code(503).send({
        error: 'Price data not available yet',
        ethPrice: null,
        lastUpdated: new Date(0).toISOString(),
        isDefault: true,
      });
    }

    // Destructure now that we know data exists
    const { lastUpdated, isDefault, ...prices } = priceData;

    const responseData = {
      ethPrice: prices, // Contains usd, eur, gbp etc.
      // lastUpdated is already an ISO string from the service
      lastUpdated: lastUpdated,
      isDefault: isDefault ?? false, // Default to false if somehow undefined after check
    };

    reply.send(responseData);
  } catch (error) {
    // Log the actual error caught
    request.log.error({ msg: 'Error retrieving ETH prices:', err: error });
    reply.code(500).send({ error: 'Internal Server Error' });
  }
}

export async function getMarketGasPrice(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const gasPrice = getGasPrice();
    reply.send(gasPrice);
  } catch (error) {
    request.log.error('Error retrieving gas price:', error);
    reply.code(500).send({ error: 'Internal Server Error' });
  }
}
