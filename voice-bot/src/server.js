import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false }); // Using custom winston logger

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Global Error handling
fastify.setErrorHandler(function (error, request, reply) {
  logger.error('Fastify error:', error);
  reply.status(500).send('Internal Server Error');
});

// Graceful shutdown hooks
fastify.addHook('onClose', (instance, done) => {
  logger.info('Server closing, stopping services...');
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the Smart Drip campaign after successful server startup
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();

// Handle process termination to trigger fastify onClose hook
const gracefulShutdown = () => {
  logger.info('Received kill signal, shutting down gracefully');
  fastify.close().then(() => {
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
