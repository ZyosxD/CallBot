import Fastify from 'fastify';
import formbodyPlugin from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import { router } from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const server = Fastify({
  logger: false // We use our own logger
});

// Register plugins
server.register(formbodyPlugin);
server.register(websocketPlugin);

// Register routes
server.register(router, { prefix: '/voice' });

// Global error handler
server.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Internal Server Error' });
});

const start = async () => {
  try {
    const port = config.server.port;
    await server.listen({ port, host: '0.0.0.0' });
    logger.info(`Server listening on port ${port}`);

    // Startup check for Public URL
    if (!config.server.publicUrl) {
      logger.warn('PUBLIC_URL is not set in environment variables. Drip Service will NOT start.');
    } else {
      logger.info('PUBLIC_URL is configured. Starting Drip Service...');
      startDrip();
    }
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err);
  process.exit(1);
});

start();
