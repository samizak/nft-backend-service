import { FastifyRequest, FastifyReply } from 'fastify';
import {
  syncAccountEventsInBackground,
  getPaginatedAccountEvents,
  getAccountEventCount,
} from './service';
import { ActivityEvent } from './types'; // Keep ActivityEvent if needed for response typing
import { WithId } from 'mongodb';

// Define interfaces for request parameters and query string
interface GetAccountActivityParams {
  address: string;
}

interface GetAccountActivityQuery {
  page?: string | number;
  limit?: string | number;
}

// Controller function
export const getAccountActivity = async (
  request: FastifyRequest<{
    Params: GetAccountActivityParams;
    Querystring: GetAccountActivityQuery;
  }>,
  reply: FastifyReply
): Promise<void> => {
  const { address } = request.params;
  const { page: pageQuery, limit: limitQuery } = request.query;

  // Validate address (basic check)
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    reply.code(400).send({
      error:
        'Invalid Ethereum address format in path parameter. Expecting a 0x-prefixed 40-character hexadecimal string.',
    });
    return;
  }

  const lowerCaseAddress = address.toLowerCase();

  // Validate and parse pagination parameters
  const page = parseInt(String(pageQuery ?? '1'), 10);
  const limit = parseInt(String(limitQuery ?? '20'), 10);

  if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > 100) {
    reply.code(400).send({
      error: 'Invalid pagination parameters. page >= 1, 1 <= limit <= 100.',
    });
    return;
  }

  const skip = (page - 1) * limit;

  // --- Trigger background sync (fire and forget) ---
  // We don't wait for it to complete, just initiate it
  syncAccountEventsInBackground(lowerCaseAddress).catch((err) => {
    console.error(
      `[Controller:${lowerCaseAddress}] Failed to initiate background sync:`,
      err
    );
    // Don't necessarily fail the request, just log the error
  });

  try {
    // Fetch data from the service (uses database)
    const [totalCount, events] = await Promise.all([
      getAccountEventCount(lowerCaseAddress),
      getPaginatedAccountEvents(lowerCaseAddress, skip, limit),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    // Format response
    reply.code(200).send({
      address: lowerCaseAddress,
      pagination: {
        currentPage: page,
        limit: limit,
        totalPages: totalPages,
        totalItems: totalCount,
      },
      // The events type here is WithId<ActivityEvent>[] from the service
      events: events,
    });
  } catch (error: any) {
    console.error(
      `[Controller:${lowerCaseAddress}] Error fetching account activity:`,
      error
    );
    reply
      .code(500)
      .send({ error: error.message || 'Failed to retrieve account activity.' });
  }
};
