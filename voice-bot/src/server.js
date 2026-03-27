import Fastify from 'fastify';
import formBodyPlugin from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(formBodyPlugin);
fastify.register(websocketPlugin);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Graceful shutdown hooks
fastify.addHook('onClose', (instance, done) => {
    logger.info('Server shutting down. Stopping Drip Engine...');
    stopDrip();
    done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start outbound drip campaign
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
