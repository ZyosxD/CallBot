import Fastify from 'fastify';
import formBodyPlugin from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register Plugins
fastify.register(formBodyPlugin);
fastify.register(websocketPlugin);

// Register Routes
fastify.register(router, { prefix: '/voice' });

// WebSocket handling (Fastify v11 API requires connection object)
fastify.register(async function (fastify) {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
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

    if (!config.server.publicUrl) {
      logger.warn('PUBLIC_URL is not set. Outbound drip service cannot start correctly, and Twilio webhooks may fail.');
    } else {
      logger.info(`PUBLIC_URL is set to ${config.server.publicUrl}`);
    }

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Smart Drip Engine if PUBLIC_URL is present
    if (config.server.publicUrl) {
        startDrip();
    }

  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
