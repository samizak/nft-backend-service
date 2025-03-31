import { FastifyRequest, FastifyReply } from 'fastify';
import { streamNftEventsByAccount } from './service';
import { StreamMessage } from './types';

interface GetEventsByAccountQuery {
  address: string;
  maxPages?: string;
}

export const getEventsByAccountSchema = {
  querystring: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
        pattern: '^0x[a-fA-F0-9]{40}$',
      },
      maxPages: { type: 'string', pattern: '^[1-9]\\d*$' },
    },
    required: ['address'],
  },
};

export const getEventsByAccountHandler = async (
  request: FastifyRequest<{ Querystring: GetEventsByAccountQuery }>,
  reply: FastifyReply
) => {
  const { address, maxPages: maxPagesStr } = request.query;
  const maxPages = maxPagesStr ? parseInt(maxPagesStr, 10) : undefined;

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');

  try {
    const sseReply = reply as any;

    await sseReply.sse(
      (async function* () {
        for await (const message of streamNftEventsByAccount(
          address,
          maxPages
        )) {
          yield { data: JSON.stringify(message) };
        }
      })()
    );
  } catch (error) {
    request.log.error(
      { err: error, query: request.query },
      'Failed to initiate event stream'
    );
    try {
      if (!reply.raw.writableEnded) {
        const errorMessage: StreamMessage = {
          type: 'error',
          error: 'Failed to initiate stream',
        };
        reply.raw.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
        reply.raw.end();
      }
    } catch (streamError) {
      request.log.error(
        { err: streamError },
        'Error sending final error message to SSE stream'
      );
    }
  }
};
