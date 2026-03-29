import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
// We will import and call startDrip() after the server starts, and stopDrip() on close
// import { startDrip, stopDrip } from './services/dripService.js';

const startServer = async () => {
  // Initialize Fastify with internal logger disabled
  const app = Fastify({ logger: false });

  // Register plugins
  await app.register(formBody);
  await app.register(fastifyWebsocket);

  // Register routes with prefix
  await app.register(router, { prefix: '/voice' });

  // Error handling hook
  app.setErrorHandler((error, request, reply) => {
    logger.error('Fastify error:', error);
    reply.status(500).send({ error: 'Internal Server Error' });
  });

  // Graceful shutdown
  app.addHook('onClose', async (instance, done) => {
    logger.info('Server is closing...');
    try {
      // If we dynamically imported startDrip/stopDrip, we do it here:
      const { stopDrip } = await import('./services/dripService.js');
      stopDrip();
    } catch (e) {
      logger.error('Error stopping drip:', e);
    }
    done();
  });

  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Drip Campaign
    const { startDrip } = await import('./services/dripService.js');
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

startServer();
