import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = Fastify({
  logger: false // Disable Fastify's default logger, we use Winston
});

// Middleware for parsing application/x-www-form-urlencoded
app.register(fastifyFormbody);

// Register WebSocket support
app.register(fastifyWebsocket);

// Register Routes
app.register(router, { prefix: '/voice' });

// Global Error Handler
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Lifecycle Hooks
app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

const startServer = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the Smart Drip campaign engine
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

startServer();
