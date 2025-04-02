import * as dotenv from 'dotenv';
dotenv.config();

import fastify from 'fastify';
import cors from '@fastify/cors';
import { FastifySSEPlugin } from 'fastify-sse-v2';
import mongoose from 'mongoose';
import qs from 'qs';

import ensRoutes from './api/ens/routes';
import userRoutes from './api/user/routes';
import nftRoutes from './api/nft/routes';
import eventRoutes from './api/event/routes';
import collectionRoutes from './api/collection/routes';
import marketRoutes from './api/market/routes';
import portfolioRoutes from './api/portfolio/routes';
import adminRoutes from './api/admin/routes';
import { env } from 'process';

import { startPriceFetcher } from './services/priceFetcher';
import { startGasFetcher } from './services/gasFetcher';
import './services/collectionFetcher';
import './services/portfolioCalculatorService';

// --- Mongoose Connection Event Listeners ---
mongoose.connection.on('connected', () => {
  console.log('[Mongoose] Connection established successfully.');
});

mongoose.connection.on('error', (err) => {
  console.error('[Mongoose] Connection error:', err);
  // Consider exiting if DB connection is critical and fails after initial connect
  // process.exit(1);
});

mongoose.connection.on('disconnected', () => {
  console.log('[Mongoose] Connection disconnected.');
});

mongoose.connection.on('reconnected', () => {
  console.log('[Mongoose] Connection reconnected.');
});
// --- End Mongoose Listeners ---

const server = fastify({
  logger: true,
  querystringParser: (str) => qs.parse(str, { parameterLimit: 5000 }),
});

// --- Register Shared Schemas BEFORE routes ---

// Standard Error Response Schema
const errorSchema = {
  $id: 'ErrorResponse', // ID to reference
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
};

// Specific Schemas reusing the standard error format
const badRequestSchema = {
  $id: 'BadRequest',
  description: 'Invalid request format or parameters',
  allOf: [{ $ref: 'ErrorResponse' }],
};

const unauthorizedSchema = {
  $id: 'Unauthorized',
  description: 'Authentication failed or required',
  allOf: [{ $ref: 'ErrorResponse' }],
};

const forbiddenSchema = {
  $id: 'Forbidden',
  description: 'Authenticated user lacks permission',
  allOf: [{ $ref: 'ErrorResponse' }],
};

const notFoundSchema = {
  $id: 'NotFound',
  description: 'Resource not found',
  allOf: [{ $ref: 'ErrorResponse' }],
};

const internalServerErrorSchema = {
  $id: 'InternalServerError',
  description: 'An unexpected server error occurred',
  allOf: [{ $ref: 'ErrorResponse' }],
};

const serviceUnavailableSchema = {
  $id: 'ServiceUnavailable',
  description: 'Service is temporarily unavailable',
  allOf: [{ $ref: 'ErrorResponse' }],
};

// Add schemas to Fastify instance
server.addSchema(errorSchema);
server.addSchema(badRequestSchema);
server.addSchema(unauthorizedSchema);
server.addSchema(forbiddenSchema);
server.addSchema(notFoundSchema);
server.addSchema(internalServerErrorSchema);
server.addSchema(serviceUnavailableSchema);

// --- End Shared Schemas ---

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
server.register(portfolioRoutes, { prefix: '/api/portfolio' });
server.register(adminRoutes, { prefix: '/api/admin' });

server.get('/', (request, reply) => {
  reply.send('NFT Backend Service is running!');
});

async function startServer() {
  const MONGODB_URI = env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error('[Server] FATAL ERROR: MONGODB_URI is not defined.');
    process.exit(1);
  }

  try {
    console.log('[Server] Attempting to connect to MongoDB via Mongoose...');
    // Connect Mongoose BEFORE starting the server listener
    await mongoose.connect(MONGODB_URI, {
      // Add recommended options based on your Mongoose version
      // e.g., useNewUrlParser: true, useUnifiedTopology: true
      serverSelectionTimeoutMS: 30000, // Increase timeout slightly if needed
    });
    // The 'connected' listener above will log success

    // Start background services that might rely on DB connection AFTER connecting
    startPriceFetcher();
    startGasFetcher();
    // collectionFetcher worker starts on import
    // portfolioCalculatorService worker starts on import

    // Start listening for requests
    await server.listen({ port: Number(env.PORT) || 8080, host: '0.0.0.0' });
  } catch (err) {
    console.error('[Server] Startup error:', err);
    // Mongoose listener 'error' will also log specific DB connection errors
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
      // await stopPriceFetcher();
      // await stopGasFetcher();

      // Disconnect Mongoose
      await mongoose.disconnect();
      console.log('[Mongoose] Disconnected.');

      await server.close(); // Close Fastify server
      console.log('[Server] Server shut down successfully.');
      process.exit(0);
    } catch (err) {
      console.error('[Server] Error during graceful shutdown:', err);
      process.exit(1);
    }
  });
});

startServer();
