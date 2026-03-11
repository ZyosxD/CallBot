import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false, // We use our own logger
});

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Startup check
if (!config.server.publicUrl) {
  logger.warn('PUBLIC_URL is not set. Drip Service will not start.');
}

const start = async () => {
  try {
    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);

    if (config.server.publicUrl) {
      startDrip();
      logger.info('Drip Service started successfully.');
    }
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
