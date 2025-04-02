import { FastifyRequest, FastifyReply } from 'fastify';
import { ethers } from 'ethers'; // Import ethers
import {
  syncAccountEventsInBackground,
  getPaginatedAccountEvents,
  getAccountEventCount,
  checkSyncStatus, // Import the new status checker
} from './service';
import { ActivityEvent } from './types'; // Keep ActivityEvent if needed for response typing
import { WithId } from 'mongodb';

// Define interfaces for request parameters and query string
interface AddressParams {
  address: string;
}

interface PaginationQuery {
  page?: string | number;
  limit?: string | number;
}

// Controller for fetching events (GET /:address)
export const getAccountActivity = async (
  request: FastifyRequest<{
    Params: AddressParams; // Use common interface
    Querystring: PaginationQuery; // Use common interface
  }>,
  reply: FastifyReply
): Promise<void> => {
  const { address } = request.params;
  const { page: pageQuery, limit: limitQuery } = request.query;

  // Validate address using ethers
  if (!ethers.isAddress(address)) {
    reply.code(400).send({ error: 'Invalid Ethereum address format.' });
    return;
  }

  const lowerCaseAddress = address.toLowerCase();

  // Validate and parse pagination parameters
  const page = parseInt(String(pageQuery ?? '1'), 10);
  const limit = parseInt(String(limitQuery ?? '20'), 10);

  if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > 100) {
    reply.code(400).send({ error: 'Invalid pagination parameters.' });
    return;
  }

  const skip = (page - 1) * limit;

  // Note: We DON'T trigger the sync here anymore.
  // The frontend will decide when to trigger it via the POST /sync endpoint.
  // syncAccountEventsInBackground(lowerCaseAddress).catch((err) => { ... });

  try {
    // Fetch data directly from the database via the service
    const [totalCount, events] = await Promise.all([
      getAccountEventCount(lowerCaseAddress),
      getPaginatedAccountEvents(lowerCaseAddress, skip, limit),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    reply.code(200).send({
      address: lowerCaseAddress,
      pagination: {
        currentPage: page,
        limit: limit,
        totalPages: totalPages,
        totalItems: totalCount,
      },
      events: events,
    });
  } catch (error: any) {
    request.log.error(
      { err: error, address: lowerCaseAddress }, // Log address with error
      `Error fetching account activity for ${lowerCaseAddress}`
    );
    reply
      .code(500)
      .send({ error: error.message || 'Failed to retrieve account activity.' });
  }
};

// --- NEW CONTROLLERS ---

// Controller for triggering sync (POST /:address/sync)
export const triggerAccountSync = async (
  request: FastifyRequest<{ Params: AddressParams }>,
  reply: FastifyReply
) => {
  const { address } = request.params;

  if (!ethers.isAddress(address)) {
    return reply.code(400).send({ error: 'Invalid Ethereum address format.' });
  }

  const lowerCaseAddress = address.toLowerCase();

  // Call the background sync function but don't wait for it
  syncAccountEventsInBackground(lowerCaseAddress).catch((err) => {
    // Log error if triggering fails, but don't fail the request
    request.log.error(
      { err, address: lowerCaseAddress },
      `Failed background sync trigger for ${lowerCaseAddress}`
    );
  });

  // Immediately return 202 Accepted
  return reply
    .code(202)
    .send({
      status: 'sync_triggered',
      message: `Background event sync initiated for ${lowerCaseAddress}.`,
    });
};

// Controller for checking sync status (GET /:address/sync-status)
export const getSyncStatus = async (
  request: FastifyRequest<{ Params: AddressParams }>,
  reply: FastifyReply
) => {
  const { address } = request.params;

  if (!ethers.isAddress(address)) {
    return reply.code(400).send({ error: 'Invalid Ethereum address format.' });
  }

  const lowerCaseAddress = address.toLowerCase();

  try {
    const status = checkSyncStatus(lowerCaseAddress);
    return reply.code(200).send({ address: lowerCaseAddress, status: status });
  } catch (error) {
    request.log.error(
      { err: error, address: lowerCaseAddress },
      `Failed to check sync status for ${lowerCaseAddress}`
    );
    return reply.code(500).send({ error: 'Failed to retrieve sync status.' });
  }
};
