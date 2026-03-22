import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(formbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Global error handler
fastify.setErrorHandler(function (error, request, reply) {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown hook
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
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
