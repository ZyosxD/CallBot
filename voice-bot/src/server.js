import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(async function (fastify) {
  fastify.register(router, { prefix: '/voice' });

  // WebSocket route needs to be registered on the fastify instance
  // Note: the path requested by Twilio will be exactly what we put in the TwiML
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Something went wrong' });
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    if (config.server.publicUrl) {
      startDrip();
    } else {
      logger.warn('PUBLIC_URL is not set. Drip Service will not start automatically.');
    }
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
