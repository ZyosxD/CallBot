import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';

// We will need to import startDrip and stopDrip later when dripService is implemented
// import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(formbody);
fastify.register(websocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Global Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Lifecycle hooks
fastify.addHook('onClose', async (instance, done) => {
  logger.info('Server closing...');
  try {
    const { stopDrip } = await import('./services/dripService.js');
    stopDrip();
  } catch (e) {
    logger.warn('dripService not available yet for stopDrip');
  }
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    try {
      const { startDrip } = await import('./services/dripService.js');
      startDrip();
    } catch (e) {
      logger.warn('dripService not available yet for startDrip');
    }
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
