import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify();

const start = async () => {
  try {
    // Register plugins
    await fastify.register(fastifyFormbody);
    await fastify.register(fastifyWebsocket);

    // Register routes
    await fastify.register(router);

    // Global error handler
    fastify.setErrorHandler((error, request, reply) => {
      logger.error(error.stack);
      reply.status(500).send('Something broke!');
    });

    const PORT = config.server.port || 3000;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    if (!config.server.publicUrl) {
      logger.warn('PUBLIC_URL is not set. Drip Service will not start.');
    } else {
      logger.info('Starting Drip Service...');
      startDrip();
    }
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
