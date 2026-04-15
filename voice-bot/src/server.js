import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Middleware
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Routes
fastify.register(router, { prefix: '/voice' });

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

fastify.addHook('onClose', async (instance, done) => {
  logger.info('Shutting down server...');
  await stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the Smart Drip campaign
    startDrip();

  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received.');
  await fastify.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received.');
  await fastify.close();
  process.exit(0);
});
