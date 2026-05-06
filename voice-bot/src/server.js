import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(formbody);
fastify.register(websocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Global Error Handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Internal Server Error');
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Fastify server is running on port ${PORT}`);

    // Start the Smart Drip Outbound logic
    startDrip();

    // Graceful Shutdown
    const closeServer = async (signal) => {
      logger.info(`Received ${signal}. Closing server gracefully...`);
      try {
        stopDrip();
        await fastify.close();
        logger.info('Server closed');
        process.exit(0);
      } catch (err) {
        logger.error('Error closing server:', err);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => closeServer('SIGINT'));
    process.on('SIGTERM', () => closeServer('SIGTERM'));

  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();