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
fastify.setErrorHandler(function (error, request, reply) {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

fastify.addHook('onClose', async (instance, done) => {
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Smart Drip engine after server is up
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
