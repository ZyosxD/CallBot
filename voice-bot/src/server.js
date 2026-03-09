import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false }); // Disable default fastify logger to use winston

// Register plugins
fastify.register(formbody);
fastify.register(websocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Start server
const start = async () => {
  try {
    if (!config.server.publicUrl) {
      logger.warn('PUBLIC_URL is not set. Outbound drip service requires PUBLIC_URL.');
    } else {
      // Start outbound drip logic
      startDrip();
    }

    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
