import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Use custom logger instead
});

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// WebSocket handling (Fastify requires connection object for ws handling v11+)
fastify.register(async function (fastify) {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    if (!config.server.publicUrl) {
      logger.warn('WARNING: config.server.publicUrl is not set. Drip Service will not start.');
    } else {
      startDrip();
    }
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
