import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ethers } from 'ethers'; // Import ethers for address validation
// Import both functions from the correct service path
import { resolveEnsName, lookupEnsAddress } from '../../services/ensService';

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

const lookupResponseSchema = {
  200: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      ensName: { type: 'string' }, // ENS name can be null if not found
    },
    required: ['address', 'ensName'], // Actually, ensName isn't required if null
  },
  // Define 404/500 responses similar to resolve if needed
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
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;
      // Basic validation already done by schema

      try {
        // Call the service function
        const address = await resolveEnsName(name);

        if (address) {
          return reply.send({ ensName: name, address });
        } else {
          // Service returns null if not found or invalid name
          return reply
            .code(404)
            .send({ error: `Could not resolve ENS name: ${name}` });
        }
      } catch (error) {
        // Catch unexpected errors from the service/provider setup
        request.log.error(
          `Error processing /resolve request for ${name}:`,
          error
        );
        return reply
          .code(500)
          .send({ error: 'Internal Server Error during ENS resolution' });
      }
    }
  );

  // --- Lookup Address to Primary ENS Name ---
  fastify.get(
    '/lookup/:address',
    {
      schema: {
        params: lookupParamsSchema,
        // Define response schema if needed, similar to lookupResponseSchema skeleton
      },
    },
    async (
      request: FastifyRequest<{ Params: { address: string } }>,
      reply: FastifyReply
    ) => {
      const { address } = request.params;

      // Validate address format strictly here or rely on service
      if (!ethers.isAddress(address)) {
        return reply
          .code(400)
          .send({ error: 'Invalid Ethereum address format.' });
      }

      try {
        // Call the service function
        const name = await lookupEnsAddress(address);

        // Always return 200, name will be null if not found
        return reply.send({ address: address, ensName: name });
      } catch (error) {
        request.log.error(
          `Error processing /lookup request for ${address}:`,
          error
        );
        return reply
          .code(500)
          .send({ error: 'Internal Server Error during ENS lookup' });
      }
    }
  );
}
