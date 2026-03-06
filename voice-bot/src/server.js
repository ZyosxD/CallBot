import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const app = Fastify({
  logger: false // Disable Fastify's default logger in favor of Winston
});

// Middleware
app.register(fastifyFormbody);
app.register(fastifyWebsocket);

// Routes
app.register(router, { prefix: '/voice' });

// Error handling plugin
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Something broke!' });
});

// Start server
const start = async () => {
  if (!config.server.publicUrl) {
    logger.warn('PUBLIC_URL is not set in the environment variables. The Drip Service will not start correctly without a public URL to serve TwiML.');
  }

  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Drip Service only if a public URL is set
    if (config.server.publicUrl) {
        startDrip();
    }
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();