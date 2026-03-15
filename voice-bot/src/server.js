import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false }); // Using our custom winston logger for stdout

// Register Plugins
fastify.register(formBody);
fastify.register(fastifyWebsocket, {
  options: { maxPayload: 1048576 }
});

// Register REST Routes
fastify.register(router, { prefix: '/voice' });

// Register WebSocket Route
fastify.register(async function (fastify) {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Error handling
fastify.setErrorHandler(function (error, request, reply) {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

const start = async () => {
  try {
    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);

    // Start Outbound Drip Engine
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
