import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
await fastify.register(fastifyFormbody);
await fastify.register(fastifyWebsocket);

// Register routes
await fastify.register(router, { prefix: '/voice' });

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown
const listeners = ['SIGINT', 'SIGTERM'];
listeners.forEach((signal) => {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    try {
      await fastify.close();
      logger.info('Fastify closed.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
});

fastify.addHook('onClose', (instance, done) => {
    logger.info('Fastify onClose hook triggered.');
    stopDrip();
    done();
});


// Start server
const start = async () => {
  try {
    const port = config.server.port;
    await fastify.listen({ port: port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${port}`);
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
