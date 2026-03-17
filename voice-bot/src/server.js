import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const server = Fastify({
  logger: false // We use our own winston logger
});

// Register plugins
server.register(formbody);
server.register(fastifyWebsocket, {
  options: { maxPayload: 1048576 }
});

// Register routes
server.register(router, { prefix: '/voice' });

// Global error handler
server.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Start server
const start = async () => {
  try {
    if (!config.server.publicUrl) {
      logger.warn('PUBLIC_URL is not set. Drip Service will not start and local Twilio validation will be skipped.');
    }

    await server.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);

    // Start Drip Service only if PUBLIC_URL is set (required for callbacks)
    if (config.server.publicUrl) {
      logger.info('Starting Smart Drip Engine...');
      startDrip();
    }

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
