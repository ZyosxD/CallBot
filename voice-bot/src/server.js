import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Use winston instead
});

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes under /voice
fastify.register(router, { prefix: '/voice' });

// Global Error Handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error('Fastify Error:', error);
  reply.status(500).send({ error: 'Internal Server Error' });
});

// Graceful Shutdown Hooks
fastify.addHook('onClose', (instance, done) => {
  logger.info('Server shutting down...');
  stopDrip();
  done();
});

const startServer = async () => {
  try {
    const port = config.server.port;
    await fastify.listen({ port: port, host: '0.0.0.0' });
    logger.info(`Server is listening on port ${port}`);

    // Initialize Smart Drip Campaign
    startDrip();

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

startServer();

// Handle termination signals
process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await fastify.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await fastify.close();
  process.exit(0);
});
