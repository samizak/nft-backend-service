import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getMarketEthPrices, getMarketGasPrice } from './controller';

const marketRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get(
    '/ethereum-prices',
    {
      // Optional: Add schema for response validation if needed
      // schema: { ... }
    },
    getMarketEthPrices
  );

  fastify.get(
    '/gas-price',
    {
      // Optional: Add schema for response validation if needed
      // schema: { ... }
    },
    getMarketGasPrice
  );
};

export default marketRoutes;
