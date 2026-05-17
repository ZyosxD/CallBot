import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown hooks
const handleShutdown = async () => {
    logger.info('Gracefully shutting down...');
    await fastify.close();
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

fastify.addHook('onClose', (instance, done) => {
    stopDrip();
    done();
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
