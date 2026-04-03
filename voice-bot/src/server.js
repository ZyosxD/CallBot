import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';

const app = Fastify({ logger: false });

async function startServer() {
  try {
    // Register plugins
    await app.register(fastifyFormbody);
    await app.register(fastifyWebsocket);

    // Register routes
    await app.register(router, { prefix: '/voice' });

    // Graceful shutdown
    app.addHook('onClose', async (instance, done) => {
      logger.info('Server closing, shutting down services...');
      try {
        const dripService = await import('./services/dripService.js');
        if (dripService.stopDrip) {
          dripService.stopDrip();
        }
      } catch (e) {
        logger.error('Error stopping drip service:', e);
      }
      done();
    });

    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Drip Service after listening
    try {
      const dripService = await import('./services/dripService.js');
      if (dripService.startDrip) {
        dripService.startDrip();
      }
    } catch (e) {
      logger.error('Error starting drip service:', e);
    }
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
}

startServer();
