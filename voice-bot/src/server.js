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

// Register routes from the router module
fastify.register(router, { prefix: '/voice' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Hook for graceful shutdown
fastify.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

// Handle graceful shutdown signals
process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down...');
  await fastify.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down...');
  await fastify.close();
  process.exit(0);
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Fastify server is running on port ${PORT}`);

    // Start Smart Drip campaign loop after server is running
    startDrip();
  } catch (err) {
    logger.error('Error starting Fastify server:', err);
    process.exit(1);
  }
};

start();
