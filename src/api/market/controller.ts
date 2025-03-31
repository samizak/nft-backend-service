import { FastifyRequest, FastifyReply } from 'fastify';
import { getEthPrices } from '../../services/priceFetcher';
import { getGasPrice } from '../../services/gasFetcher';

export async function getMarketEthPrices(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const prices = getEthPrices();
    reply.send(prices);
  } catch (error) {
    request.log.error('Error retrieving ETH prices:', error);
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
