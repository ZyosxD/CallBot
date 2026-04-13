import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
// We'll dynamically import stopDrip, startDrip below to avoid circular dependency issues if any
// or just import them here
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Use winston logger exclusively
});

// Register plugins
await fastify.register(fastifyFormbody);
await fastify.register(fastifyWebsocket);

// Register routes
await fastify.register(router, { prefix: '/voice' });

// Global Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown
fastify.addHook('onClose', (instance, done) => {
  logger.info('Server is shutting down...');
  stopDrip();
  done();
});

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, starting graceful shutdown`);
    await fastify.close();
    process.exit(0);
  });
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Fastify server listening on port ${PORT}`);

    // Start the Smart Drip campaign after server successfully starts
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
