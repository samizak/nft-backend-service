import * as dotenv from 'dotenv';
dotenv.config(); 

import fastify from 'fastify';
import cors from '@fastify/cors';
import ensRoutes from './api/ens/routes'; 
import userRoutes from './api/user/routes';
import { env } from 'process';

const server = fastify({ logger: true }); 

server.register(cors, { 
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

server.register(ensRoutes, { prefix: '/ens' });
server.register(userRoutes, { prefix: '/user' });

server.get('/', (request, reply) => {
  reply.send('NFT Backend Service is running!');
});

const start = async () => {
  try {
    await server.listen({ port: Number(env.PORT) || 8080 });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
