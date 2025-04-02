import { FastifyRequest, FastifyReply } from 'fastify';
import { ethers } from 'ethers';
import { resolveEnsName, lookupEnsAddress } from './service';

// Define interfaces for request parameters
interface ResolveParams {
  name: string;
}
interface LookupParams {
  address: string;
}

// Controller function for resolving ENS name
export async function resolveEnsNameController(
  request: FastifyRequest<{ Params: ResolveParams }>,
  reply: FastifyReply
) {
  const { name } = request.params;
  // Basic validation already done by schema in routes.ts

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
    request.log.error(`Error processing /resolve request for ${name}:`, error);
    return reply
      .code(500)
      .send({ error: 'Internal Server Error during ENS resolution' });
  }
}

// Controller function for looking up address
export async function lookupEnsAddressController(
  request: FastifyRequest<{ Params: LookupParams }>,
  reply: FastifyReply
) {
  const { address } = request.params;

  // Validate address format strictly here
  if (!ethers.isAddress(address)) {
    return reply.code(400).send({ error: 'Invalid Ethereum address format.' });
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
