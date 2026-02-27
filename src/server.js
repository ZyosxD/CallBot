import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(formBody);
fastify.register(fastifyWs);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Default route
fastify.get('/', async (request, reply) => {
  return { message: 'Voice Bot Server is running!' };
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Drip Service
    if (config.server.publicUrl) {
      startDrip();
    } else {
      logger.warn('Public URL not set, Drip Service will not start.');
    }

  } catch (err) {
    logger.error(err); // Changed from fastify.log.error to logger.error
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received. Shutting down...');
    stopDrip();
    await fastify.close();
    logger.info('Server closed.');
    process.exit(0);
});

start();
