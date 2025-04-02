import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  getBatchCollections,
  getAlchemyFloorPriceHandler,
  getAlchemyFloorPriceSchema,
} from './controller';

async function collectionRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // POST /collection/batch-collections
  fastify.post(
    '/batch-collections',
    {
      schema: {
        body: {
          type: 'object',
          required: ['collections'],
          properties: {
            collections: {
              type: 'array',
              description: 'Array of collection identifiers',
              minItems: 1,
              maxItems: 50,
              items: {
                type: 'object',
                properties: {
                  slug: {
                    type: 'string',
                    description:
                      'OpenSea collection slug (required if contract missing)',
                  },
                  contract: {
                    type: 'string',
                    description:
                      'Collection contract address (required if slug missing)',
                  },
                },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                description: 'Map of contractAddress to collection data',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    slug: { type: ['string', 'null'] },
                    name: { type: ['string', 'null'] },
                    description: { type: ['string', 'null'] },
                    image_url: { type: ['string', 'null'] },
                    safelist_status: { type: ['string', 'null'] },
                    floor_price: { type: 'number' },
                    total_supply: { type: 'number' },
                    num_owners: { type: 'number' },
                    total_volume: { type: 'number' },
                    market_cap: { type: 'number' },
                  },
                },
              },
            },
          },
          400: { $ref: 'BadRequest#' },
          500: { $ref: 'InternalServerError#' },
        },
      },
    },
    getBatchCollections
  );

  // GET /collection/alchemy-floor-price/:contract_address
  fastify.get(
    '/alchemy-floor-price/:contract_address',
    {
      schema: {
        params: getAlchemyFloorPriceSchema.params,
        response: {
          200: getAlchemyFloorPriceSchema.response[200],
          400: { $ref: 'BadRequest#' },
          500: { $ref: 'InternalServerError#' },
          503: { $ref: 'ServiceUnavailable#' },
        },
      },
    },
    getAlchemyFloorPriceHandler
  );
}

export default collectionRoutes;
