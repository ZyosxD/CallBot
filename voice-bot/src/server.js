import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';

// Fastify is initialized with { logger: false } to use custom winston logger
const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Graceful shutdown
const listeners = ['SIGINT', 'SIGTERM'];
listeners.forEach((signal) => {
  process.on(signal, async () => {
    logger.info(`Received ${signal}. Shutting down server gracefully...`);
    await fastify.close();
    process.exit(0);
  });
});

fastify.addHook('onClose', async (instance, done) => {
  try {
    const { stopDrip } = await import('./services/dripService.js');
    stopDrip();
  } catch (error) {
    logger.error('Error stopping drip on close:', error);
  }
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Explicitly call startDrip after fastify listens
    const { startDrip } = await import('./services/dripService.js');
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
