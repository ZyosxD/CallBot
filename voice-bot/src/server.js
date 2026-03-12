import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false, // We use winston
});

// Register Plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register Routes
fastify.register(router);

// Error Handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Something went wrong' });
});

// Start the server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server listening on ${fastify.server.address().port}`);

    // Ensure PUBLIC_URL is set before starting the Drip Service
    if (config.server.publicUrl) {
        startDrip();
    } else {
        logger.warn('PUBLIC_URL is not set. Drip Service will NOT start.');
    }

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
