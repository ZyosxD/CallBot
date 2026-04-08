import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Use our custom Winston logger instead
});

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket, {
  options: { maxPayload: 1048576 }
});

// Register routes
fastify.register(router, { prefix: '/voice' });

// Add hook for graceful shutdown
fastify.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Initialize Smart Drip campaign after server starts
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
