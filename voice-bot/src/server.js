import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';

// The startDrip will be imported dynamically or we can do it directly
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Use custom winston logger instead
});

// Register plugins
fastify.register(formbody);
fastify.register(websocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Graceful shutdown handling
const handleShutdown = async (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  await fastify.close();
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

fastify.addHook('onClose', async (instance, done) => {
  logger.info('Fastify is closing...');
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);
    startDrip(); // Initialize smart drip after successful startup
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
