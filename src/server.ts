import * as dotenv from 'dotenv';
dotenv.config(); 

import fastify from 'fastify';
import ensRoutes from './api/ens/routes'; 
import { env } from 'process';

const server = fastify({ logger: true }); 

server.register(ensRoutes, { prefix: '/ens' });

server.get('/', (request, reply) => {
  reply.send('Hello, world!');
});

server.listen({ port: Number(env.PORT) }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
