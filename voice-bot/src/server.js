import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDripService } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket, {
  options: { maxPayload: 1048576 }
});

// Register routes
fastify.register(router, { prefix: '/voice' });

// WebSocket route explicitly matching full Twilio path
fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
  handleWebSocket(connection, req);
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Start server
const start = async () => {
  try {
    if (!config.server.publicUrl) {
      logger.warn('PUBLIC_URL is not set. Drip Service will not start.');
    } else {
      startDripService();
    }

    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
