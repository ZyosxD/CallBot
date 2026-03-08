import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import routes from './controllers/router.js';
import { startDrip } from './services/dripService.js';
import logger from './utils/logger.js';

const fastify = Fastify({ logger: false }); // Using our custom logger instead

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(routes, { prefix: '/voice' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Something went wrong' });
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port || 3000;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Drip Service validation
    if (!config.server.publicUrl) {
      logger.warn('PUBLIC_URL is not set in the environment variables. Smart Drip Service will not start to prevent unroutable outbound calls.');
    } else {
      startDrip();
    }

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
