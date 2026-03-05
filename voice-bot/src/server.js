import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Use custom logger below
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

const startServer = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Fastify server is running on port ${PORT}`);

    // Drip Engine Startup Check
    if (!config.server.publicUrl) {
      logger.warn('PUBLIC_URL is not set in environment. Outbound Smart Drip Engine will not start.');
    } else {
      startDrip();
    }
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

startServer();
