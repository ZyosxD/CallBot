import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import voiceRoutes from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startScheduler } from './services/scheduler.js';

const fastify = Fastify({
  logger: false // Use our own logger
});

// Register plugins
fastify.register(fastifyFormBody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(async (fastify) => {
  // WebSocket route for media stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection.socket, req);
  });

  // Regular routes
  fastify.register(voiceRoutes);
}, { prefix: '/voice' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error);
  reply.status(500).send({ error: 'Internal Server Error' });
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the scheduler
    startScheduler();

  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
