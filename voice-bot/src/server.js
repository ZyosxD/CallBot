import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';

const fastify = Fastify({ logger: false });

async function buildServer() {
  await fastify.register(fastifyWebsocket);
  await fastify.register(fastifyFormbody);

  await fastify.register(router, { prefix: '/voice' });

  fastify.setErrorHandler((error, request, reply) => {
    logger.error(error.stack);
    reply.status(500).send('Something broke!');
  });

  return fastify;
}

const startServer = async () => {
  try {
    await buildServer();
    const PORT = config.server.port;

    // Add onClose hook before listen
    fastify.addHook('onClose', async (instance, done) => {
      try {
        const { stopDrip } = await import('./services/dripService.js');
        stopDrip();
      } catch (e) {
         // ignore
      }
      done();
    });

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Lazy load and start drip service to avoid circular dependencies and ensure server is up
    const { startDrip } = await import('./services/dripService.js');
    startDrip();

    // Graceful Shutdown Hooks
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      await fastify.close();
      logger.info('Server closed');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

startServer();
