import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { stopDrip, startDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false
});

// Register Plugins
fastify.register(formbody);
fastify.register(websocketPlugin);

// Register Routes
fastify.register(router, { prefix: '/voice' });

// Global Error Handler
fastify.setErrorHandler(function (error, request, reply) {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Something went wrong' });
});

// Graceful Shutdown
fastify.addHook('onClose', async (instance, done) => {
  logger.info('Shutting down server...');
  stopDrip();
  done();
});

// Start Server
const start = async () => {
  try {
    const port = config.server.port;
    await fastify.listen({ port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${port}`);
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
