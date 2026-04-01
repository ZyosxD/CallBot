import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

// Initialize Fastify, passing { logger: false } to rely on Winston
const app = Fastify({ logger: false });

// Register formbody parsing for Twilio's application/x-www-form-urlencoded payloads
app.register(fastifyFormbody);

// Register websocket support
app.register(fastifyWebsocket);

// Register routes
app.register(router, { prefix: '/voice' });

// Global Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error);
  reply.status(500).send({ error: 'Something went wrong' });
});

// Graceful shutdown logic
app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start outbound drip campaign once server is ready
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
