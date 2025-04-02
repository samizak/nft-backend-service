import { FastifyRequest, FastifyReply } from 'fastify';
import { getBatchCollectionDataFromCache } from './service';
import { BatchCollectionsRequestBody } from './types';
import {
  fetchNFTGOCollectionInfo,
  fetchNFTGOFloorPrice,
} from '../../services/nftgoFetcher';
import { fetchBatchCollectionData } from './service';

export async function getBatchCollections(
  request: FastifyRequest<{
    Body: BatchCollectionsRequestBody;
  }>,
  reply: FastifyReply
) {
  try {
    const { collection_slugs, contract_addresses } = request.body;

    if (
      !Array.isArray(collection_slugs) ||
      !Array.isArray(contract_addresses)
    ) {
      return reply.code(400).send({
        error: 'Both collection_slugs and contract_addresses must be arrays',
      });
    }

    if (collection_slugs.length !== contract_addresses.length) {
      return reply.code(400).send({
        error:
          'collection_slugs and contract_addresses must have the same length',
      });
    }

    const result = await fetchBatchCollectionData(
      collection_slugs,
      contract_addresses
    );
    return reply.send(result);
  } catch (error) {
    request.log.error('Error in getBatchCollections:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

interface GetNFTGOCollectionInfoBody {
  collections: string[];
}

export const getNFTGOCollectionInfoSchema = {
  body: {
    type: 'object',
    properties: {
      collections: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 50,
      },
    },
    required: ['collections'],
  },
};

export const getNFTGOCollectionInfoHandler = async (
  request: FastifyRequest<{ Body: GetNFTGOCollectionInfoBody }>,
  reply: FastifyReply
) => {
  const { collections } = request.body;

  try {
    const results = await fetchNFTGOCollectionInfo(collections);
    reply.code(200).send({ collections: results });
  } catch (error) {
    request.log.error(
      { err: error, body: request.body },
      'Failed to get NFTGO collection info'
    );

    if (error instanceof Error) {
      if (error.message.includes('NFTGO_API_KEY')) {
        return reply
          .code(500)
          .send({ error: 'Internal server configuration error.' });
      }
      if (error.message.includes('429')) {
        return reply
          .code(429)
          .send({ error: 'Rate limit exceeded when contacting NFTGO.' });
      }
    }

    reply.code(500).send({
      error:
        'An internal server error occurred while fetching collection info.',
    });
  }
};

interface GetNFTGOFloorPriceParams {
  contract_address: string;
}

export const getNFTGOFloorPriceSchema = {
  params: {
    type: 'object',
    properties: {
      contract_address: {
        type: 'string',
        pattern: '^0x[a-fA-F0-9]{40}$',
      },
    },
    required: ['contract_address'],
  },
};

export const getNFTGOFloorPriceHandler = async (
  request: FastifyRequest<{ Params: GetNFTGOFloorPriceParams }>,
  reply: FastifyReply
) => {
  const { contract_address } = request.params;

  try {
    const results = await fetchNFTGOFloorPrice(contract_address);
    reply.code(200).send({ floor_prices: results });
  } catch (error) {
    request.log.error(
      { err: error, params: request.params },
      'Failed to get NFTGO floor price'
    );

    if (error instanceof Error) {
      if (error.message.includes('NFTGO_API_KEY')) {
        return reply
          .code(500)
          .send({ error: 'Internal server configuration error.' });
      }
      if (error.message.includes('Invalid contract address format')) {
        return reply
          .code(400)
          .send({ error: 'Invalid contract address format.' });
      }
      if (error.message.includes('429')) {
        return reply
          .code(429)
          .send({ error: 'Rate limit exceeded when contacting NFTGO.' });
      }
    }

    reply.code(500).send({
      error: 'An internal server error occurred while fetching floor price.',
    });
  }
};
