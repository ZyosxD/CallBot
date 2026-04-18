import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';

// Import stopDrip from dripService. It will be created later.
// We use a dynamic import or require, but since we will implement dripService, let's just import it now.
// For now, we will assume it's created and exported. To avoid errors, we'll try to import and catch.

const fastify = Fastify({
  logger: false // Disable Fastify's default logger
});

// Register plugins
await fastify.register(fastifyFormbody);
await fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Try to start the smart drip engine if the module exists
    try {
      const { startDrip } = await import('./services/dripService.js');
      startDrip();
    } catch (err) {
      logger.warn('dripService not found or failed to start: ' + err.message);
    }

  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    try {
      const { stopDrip } = await import('./services/dripService.js');
      stopDrip();
    } catch (err) {
      // Ignore if not implemented yet
    }
    await fastify.close();
    logger.info('Server closed');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
