import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';

// Setup fastify and disable built-in logger to use custom Winston logger
const fastify = Fastify({ logger: false });

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

// Shutdown logic
let stopDripFn = null;

const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Dynamic import to avoid circular dependencies and properly start drip service
    const { startDrip, stopDrip } = await import('./services/dripService.js');
    stopDripFn = stopDrip;

    // Start drip engine
    startDrip();

  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const handleShutdown = async (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  if (stopDripFn) {
    stopDripFn();
  }
  await fastify.close();
  logger.info('Server closed');
  process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

start();
