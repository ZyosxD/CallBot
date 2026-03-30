import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Routes
fastify.register(router, { prefix: '/voice' });

// Graceful shutdown
fastify.addHook('onClose', (instance, done) => {
  logger.info('Server shutting down, stopping drip service...');
  stopDrip();
  done();
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the Smart Drip campaign after server starts
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
