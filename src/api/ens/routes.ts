import { FastifyInstance } from 'fastify';
// Removed ethers import if not directly used here anymore

// Import controller functions
import {
  resolveEnsNameController,
  lookupEnsAddressController,
} from './controller';

// --- Schemas ---

// Schema for /resolve/:name requests
const resolveParamsSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 3 }, // Basic validation for name
  },
  required: ['name'],
};

const resolveResponseSchema = {
  200: {
    // Success response
    type: 'object',
    properties: {
      ensName: { type: 'string' },
      address: { type: 'string' },
    },
    required: ['ensName', 'address'],
  },
  404: {
    // Not found response
    type: 'object',
    properties: { error: { type: 'string' } },
    required: ['error'],
  },
  // Other error responses (400, 500) could be defined too
};

// Schema for /lookup/:address requests
const lookupParamsSchema = {
  type: 'object',
  properties: {
    // Use ethers validation pattern or allow Fastify default string
    // address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }
    address: { type: 'string' }, // Service layer will validate format
  },
  required: ['address'],
};

// --- Routes Plugin ---

export default async function (fastify: FastifyInstance) {
  // --- Resolve ENS Name to Address ---
  fastify.get(
    '/resolve/:name',
    {
      schema: {
        params: resolveParamsSchema,
        response: resolveResponseSchema,
      },
    },
    // Use controller function as handler
    resolveEnsNameController
  );

  // --- Lookup Address to Primary ENS Name ---
  fastify.get(
    '/lookup/:address',
    {
      schema: {
        params: lookupParamsSchema,
        // Define response schema if needed
      },
    },
    // Use controller function as handler
    lookupEnsAddressController
  );
}
