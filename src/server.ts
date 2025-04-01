import * as dotenv from 'dotenv';
dotenv.config();

import fastify from 'fastify';
import cors from '@fastify/cors';
import { FastifySSEPlugin } from 'fastify-sse-v2';

import ensRoutes from './api/ens/routes';
import userRoutes from './api/user/routes';
import nftRoutes from './api/nft/routes';
import eventRoutes from './api/event/routes';
import collectionRoutes from './api/collection/routes';
import marketRoutes from './api/market/routes';
import { env } from 'process';

import { startPriceFetcher } from './services/priceFetcher';
import { startGasFetcher } from './services/gasFetcher';
import { connectToDatabase, disconnectFromDatabase } from './lib/db';

const server = fastify({
  logger: true,
  querystringParser: (str) =>
    require('qs').parse(str, { parameterLimit: 5000 }),
});

server.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});
server.register(FastifySSEPlugin);

server.register(ensRoutes, { prefix: '/api/ens' });
server.register(userRoutes, { prefix: '/api/user' });
server.register(nftRoutes, { prefix: '/api/nft' });
server.register(eventRoutes, { prefix: '/api/event' });
server.register(collectionRoutes, { prefix: '/api/collection' });
server.register(marketRoutes, { prefix: '/api/market' });

server.get('/', (request, reply) => {
  reply.send('NFT Backend Service is running!');
});

async function startServer() {
  try {
    // Start background services
    startPriceFetcher();
    startGasFetcher();

    await server.listen({ port: Number(env.PORT) || 8080, host: '0.0.0.0' });

    // Connect to Database *after* other initializations
    await connectToDatabase();

    // Start background services *after* successful server start and DB connection
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    try {
      // Stop background services first (if applicable)
      // await stopPriceFetcher(); // Assuming stop functions exist
      // await stopGasFetcher();

      await disconnectFromDatabase(); // Disconnect DB
      await server.close(); // Close Fastify server
      console.log('Server shut down successfully.');
      process.exit(0);
    } catch (err) {
      console.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  });
});

startServer();
