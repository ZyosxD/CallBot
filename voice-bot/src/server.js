import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

fastify.register(router, { prefix: '/voice' });

fastify.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

const startServer = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Fastify server running on port ${PORT}`);

    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

startServer();

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  await fastify.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  await fastify.close();
  process.exit(0);
});
