import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false }); // Disable default fastify logger to use winston

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register HTTP routes
fastify.register(router, { prefix: '/voice' });

// Register WebSocket route directly matching the full path requested by Twilio
fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
  handleWebSocket(connection, req);
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Something broke!' });
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Smart Drip Engine
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully.');
  stopDrip();
  fastify.close().then(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully.');
  stopDrip();
  fastify.close().then(() => {
    process.exit(0);
  });
});

start();
