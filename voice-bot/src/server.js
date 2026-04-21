import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Disable built-in fastify logger, we use winston
});

// Plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket, {
  options: {
    maxPayload: 1048576,
  }
});

// Routes
fastify.register(router, { prefix: '/voice' });

// Global Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Internal Server Error');
});

// Graceful shutdown
const closeGracefully = async (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', () => closeGracefully('SIGINT'));
process.on('SIGTERM', () => closeGracefully('SIGTERM'));

fastify.addHook('onClose', async (instance, done) => {
  logger.info('Server is closing, stopping Drip Service...');
  stopDrip();
  done();
});

const start = async () => {
  try {
    const port = config.server.port;
    await fastify.listen({ port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${port}`);

    // Start Drip Service after successful server start
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
