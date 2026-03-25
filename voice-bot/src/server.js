import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = Fastify({
  logger: false // Use custom winston logger instead
});

// Register plugins
app.register(formbody);
app.register(fastifyWebsocket, {
  options: {
    maxPayload: 1048576,
  }
});

// Register routes
app.register(router, { prefix: '/voice' });

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown
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

    // Start the drip service after server starts
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
