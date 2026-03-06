import Fastify from 'fastify';
import formBodyPlugin from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const fastify = Fastify({
  logger: false // Use custom winston logger instead
});

// Register plugins
fastify.register(formBodyPlugin);
fastify.register(websocketPlugin);

// Register routes
fastify.register(router);

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error('Fastify Error:', error);
  reply.status(500).send({ error: 'Internal Server Error' });
});

const start = async () => {
  try {
    if (!config.server.publicUrl) {
      logger.warn('WARNING: config.server.publicUrl is not set. Drip Service will NOT start.');
    } else {
      logger.info(`Public URL configured as: ${config.server.publicUrl}`);
      // Start Drip Service only if Public URL is present
      startDrip();
    }

    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
