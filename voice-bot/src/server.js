import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false }); // Use winston instead of built-in

fastify.register(formBody);
fastify.register(fastifyWebsocket);

fastify.register(router, { prefix: '/voice' });

// Add hook for graceful shutdown
fastify.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

const startServer = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Smart Drip campaign
    startDrip();
  } catch (err) {
    logger.error('Error starting Fastify server:', err);
    process.exit(1);
  }
};

startServer();
