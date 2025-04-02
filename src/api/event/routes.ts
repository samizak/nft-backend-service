import { FastifyInstance } from 'fastify';
import {
  getAccountActivity,
  triggerAccountSync,
  getSyncStatus,
} from './controller';

// Define schema for pagination query parameters
const paginationQuerySchema = {
  $id: 'PaginationQuery',
  type: 'object',
  properties: {
    page: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' },
    limit: { type: 'string', pattern: '^[1-9]\\d*$', default: '20' },
  },
};

// Define schema for address path parameter
const addressParamSchema = {
  $id: 'AddressParam',
  type: 'object',
  properties: {
    address: { type: 'string', description: 'Ethereum address (0x...)' },
  },
  required: ['address'],
};

// Response schema for GET /by-account/:address
const getActivityResponseSchema = {
  200: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      pagination: {
        type: 'object',
        properties: {
          currentPage: { type: 'number' },
          limit: { type: 'number' },
          totalPages: { type: 'number' },
          totalItems: { type: 'number' },
        },
      },
      events: { type: 'array' },
    },
  },
  400: { $ref: 'BadRequest#' },
  500: { $ref: 'InternalServerError#' },
};

// Response schema for POST /:address/sync
const triggerSyncResponseSchema = {
  202: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['sync_triggered'] },
      message: { type: 'string' },
    },
  },
  400: { $ref: 'BadRequest#' },
  500: { $ref: 'InternalServerError#' },
};

// Response schema for GET /:address/sync-status
const syncStatusResponseSchema = {
  200: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      status: { type: 'string', enum: ['syncing', 'idle'] },
    },
  },
  400: { $ref: 'BadRequest#' },
  500: { $ref: 'InternalServerError#' },
};

async function eventRoutes(fastify: FastifyInstance) {
  // Register reusable schemas
  fastify.addSchema(paginationQuerySchema);
  fastify.addSchema(addressParamSchema);

  // GET /api/event/:address - Returns paginated events from DB
  fastify.get(
    '/:address',
    {
      schema: {
        params: { $ref: 'AddressParam#' },
        querystring: { $ref: 'PaginationQuery#' },
        response: getActivityResponseSchema,
      },
    },
    getAccountActivity
  );

  // POST /api/event/:address/sync - Triggers background sync
  fastify.post(
    '/:address/sync',
    {
      schema: {
        params: { $ref: 'AddressParam#' },
        response: triggerSyncResponseSchema,
      },
    },
    triggerAccountSync
  );

  // GET /api/event/:address/sync-status - Checks if sync is running
  fastify.get(
    '/:address/sync-status',
    {
      schema: {
        params: { $ref: 'AddressParam#' },
        response: syncStatusResponseSchema,
      },
    },
    getSyncStatus
  );
}

export default eventRoutes;
