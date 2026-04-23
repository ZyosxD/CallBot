import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Custom logger will be used instead
});

// Middleware
fastify.register(formbody);
fastify.register(websocketPlugin);

// Routes
fastify.register(router, { prefix: '/voice' });

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error('Fastify Error:', error);
  reply.status(500).send({ error: 'Internal Server Error' });
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  stopDrip();
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Initialize Smart Drip campaign engine
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
