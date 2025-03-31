import * as dotenv from 'dotenv';
dotenv.config(); 

import fastify from 'fastify';
import cors from '@fastify/cors';
import { FastifySSEPlugin } from 'fastify-sse-v2';

import ensRoutes from './api/ens/routes'; 
import userRoutes from './api/user/routes';
import nftRoutes from './api/nft/routes';
import eventRoutes from './api/event/routes';
import { env } from 'process';

const server = fastify({ 
    logger: true,
    querystringParser: str => require('qs').parse(str, { parameterLimit: 5000 })
}); 

server.register(cors, { 
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});
server.register(FastifySSEPlugin);

server.register(ensRoutes, { prefix: '/ens' });
server.register(userRoutes, { prefix: '/user' });
server.register(nftRoutes, { prefix: '/nft' });
server.register(eventRoutes, { prefix: '/event' });

server.get('/', (request, reply) => {
  reply.send('NFT Backend Service is running!');
});

const start = async () => {
  try {
    await server.listen({ port: Number(env.PORT) || 8080, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
