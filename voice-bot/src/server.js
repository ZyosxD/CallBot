import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

fastify.register(router, { prefix: '/voice' });

// Setup global error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Start server
const PORT = config.server.port;
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    logger.error(err);
    process.exit(1);
  }
  logger.info(`Server is running on ${address}`);

  if (!config.server.publicUrl) {
    logger.warn('WARNING: PUBLIC_URL is not set. Outbound Drip Service will not start.');
  } else {
    logger.info('Starting Smart Drip Service...');
    startDrip();
  }
});
