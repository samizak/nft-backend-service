import { FastifyRequest, FastifyReply } from 'fastify';
import { ethers } from 'ethers'; // Import ethers for address validation
import { BatchCollectionsRequestBody } from './types';
import { fetchBatchCollectionData } from './service';
// Import necessary functions directly now that fetchAlchemyFloorPriceInternal is exported
import { fetchAlchemyFloorPriceInternal } from '../../utils/collectionApi';

export async function getBatchCollections(
  request: FastifyRequest<{
    Body: BatchCollectionsRequestBody;
  }>,
  reply: FastifyReply
) {
  try {
    // Revert to using original body structure
    const { collection_slugs, contract_addresses } = request.body;

    // Original validation
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

    // Optional: Add address validation for contract_addresses here if desired
    // for (const addr of contract_addresses) {
    //    if (!ethers.isAddress(addr)) {
    //        return reply.code(400).send({ error: `Invalid contract address format: ${addr}` });
    //    }
    // }

    const result = await fetchBatchCollectionData(
      collection_slugs,
      contract_addresses
    );
    // Wrap result in data object as before
    return reply.send({ data: result });
  } catch (error) {
    request.log.error('Error in getBatchCollections:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// Remove old NFTGO handler and schema
// export const getNFTGOCollectionInfoSchema = { ... };
// export const getNFTGOCollectionInfoHandler = async (...) => { ... };

// Remove old NFTGO handler and schema
// export const getNFTGOFloorPriceSchema = { ... };
// export const getNFTGOFloorPriceHandler = async (...) => { ... };

// --- New Alchemy Floor Price Endpoint ---

interface GetAlchemyFloorPriceParams {
  contract_address: string;
}

export const getAlchemyFloorPriceSchema = {
  params: {
    type: 'object',
    properties: {
      contract_address: {
        type: 'string',
        description: 'Ethereum contract address for the NFT collection',
      },
    },
    required: ['contract_address'],
  },
  response: {
    200: {
      type: 'object',
      properties: {
        contractAddress: { type: 'string' },
        floorPriceEth: { type: 'number' },
        source: { type: 'string', enum: ['Alchemy'] },
      },
    },
    400: { type: 'object', properties: { error: { type: 'string' } } },
    // 404 removed as we now return 200 with 0 price for not found
    // 404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } },
    503: { type: 'object', properties: { error: { type: 'string' } } },
  },
};

export const getAlchemyFloorPriceHandler = async (
  request: FastifyRequest<{ Params: GetAlchemyFloorPriceParams }>,
  reply: FastifyReply
) => {
  const { contract_address } = request.params;

  if (!ethers.isAddress(contract_address)) {
    return reply.code(400).send({ error: 'Invalid contract address format.' });
  }

  if (!process.env.ALCHEMY_API_KEY) {
    request.log.error('[API Alchemy Floor] ALCHEMY_API_KEY is not configured.');
    return reply
      .code(503)
      .send({ error: 'Floor price service is not configured.' });
  }

  try {
    // Call the now-exported internal function directly
    const priceResult = await fetchAlchemyFloorPriceInternal(contract_address);

    // Return 200 OK with price (even if 0, indicates successful check but no floor found)
    return reply.code(200).send({
      contractAddress: contract_address,
      floorPriceEth: priceResult,
      source: 'Alchemy',
    });
  } catch (error) {
    // Log the specific error encountered during the fetch
    request.log.error(
      { err: error, contract: contract_address }, // Log contract address with error
      '[API Alchemy Floor] Error calling fetchAlchemyFloorPriceInternal'
    );
    // Send generic 500
    return reply.code(500).send({
      error:
        'An internal server error occurred while fetching the floor price.',
    });
  }
};
