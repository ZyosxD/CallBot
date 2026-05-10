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

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  await fastify.close();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

fastify.addHook('onClose', async () => {
  stopDrip();
  logger.info('Server successfully closed.');
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
