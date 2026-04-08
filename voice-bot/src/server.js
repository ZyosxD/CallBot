import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

fastify.register(formbody);
fastify.register(websocketPlugin);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown
fastify.addHook('onClose', (instance, done) => {
  logger.info('Server is shutting down, stopping drip campaign...');
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start drip campaign
    startDrip();
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
