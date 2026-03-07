import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { handleWebSocket } from './controllers/callController.js';
import { startDrip } from './services/dripService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(fastifyWebsocket);
fastify.register(fastifyFormbody);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Setup WebSocket endpoint
fastify.register(async function (fastify) {
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

const start = async () => {
  try {
    if (!config.server.publicUrl) {
      logger.warn('WARNING: PUBLIC_URL is not set in environment variables. Drip Service will not start correctly.');
    }

    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);

    // Start the Smart Drip service for outbound calls
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
