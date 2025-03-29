import fastify from 'fastify';

const server = fastify();

server.get('/', (request, reply) => {
  reply.send('Hello, world!');
});

server.listen({ port: 3000 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
