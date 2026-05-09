import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import routes from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false, // Disable built-in logger to use Winston instead
});

// Register plugins
fastify.register(formbody);
fastify.register(websocket);

// Register routes
fastify.register(routes, { prefix: '/voice' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown hooks
fastify.addHook('onClose', (instance, done) => {
  logger.info('Server closing, stopping Drip Service...');
  stopDrip();
  done();
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Initialize Smart Drip campaign after successful server start
    startDrip();
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();

// Handle process termination to close fastify gracefully
const handleGracefulShutdown = () => {
  logger.info('Received shutdown signal, initiating graceful shutdown...');
  fastify.close().then(
    () => {
      logger.info('Server successfully closed.');
      process.exit(0);
    },
    (err) => {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
  );
};

process.on('SIGINT', handleGracefulShutdown);
process.on('SIGTERM', handleGracefulShutdown);