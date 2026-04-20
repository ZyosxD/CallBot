import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

// Disable built-in Fastify logger to use custom Winston logger
const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Internal Server Error');
});

// Hook for graceful shutdown
fastify.addHook('onClose', (instance, done) => {
  logger.info('Server is shutting down...');
  stopDrip();
  done();
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the Smart Drip campaign after server is listening
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

// Handle process signals
const shutdown = async (signal) => {
  logger.info(`Received ${signal}. Gracefully shutting down...`);
  try {
    await fastify.close();
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
