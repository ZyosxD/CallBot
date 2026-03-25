import Fastify from 'fastify';
import formBodyPlugin from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { stopDrip, startDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(formBodyPlugin);
fastify.register(websocketPlugin, {
  options: { maxPayload: 1048576 }
});

// Register routes with prefix /voice
fastify.register(router, { prefix: '/voice' });

// Graceful shutdown
fastify.addHook('onClose', (instance, done) => {
  logger.info('Server shutting down, stopping drip engine...');
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
