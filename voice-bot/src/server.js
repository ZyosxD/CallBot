import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const server = Fastify();

// Register plugins
server.register(fastifyFormbody);
server.register(fastifyWebsocket);

// Register routes
server.register(router, { prefix: '/voice' });

// Global error handler
server.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await server.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    if (!config.server.publicUrl) {
      logger.warn('PUBLIC_URL is not set. Drip Service will not start.');
    } else {
      startDrip();
    }
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
