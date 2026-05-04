import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import logger from './utils/logger.js';
import router from './controllers/router.js';

// We need to dynamically import startDrip and stopDrip to prevent circular dependencies early on
// or we can just import them if dripService is implemented later
let dripService;

const fastify = Fastify({
  logger: false // Custom logger is used instead
});

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Internal Server Error');
});

// Graceful shutdown logic
const stopGracefully = async () => {
  logger.info('Received shutdown signal. Stopping...');
  if (dripService && dripService.stopDrip) {
      dripService.stopDrip();
  }
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', stopGracefully);
process.on('SIGTERM', stopGracefully);

fastify.addHook('onClose', async (instance, done) => {
    if (dripService && dripService.stopDrip) {
        dripService.stopDrip();
    }
    done();
});


// Start server
const startServer = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Import and start drip dynamically
    try {
        dripService = await import('./services/dripService.js');
        if (dripService.startDrip) {
            dripService.startDrip();
        }
    } catch (e) {
        logger.warn('dripService not found or failed to load yet. Drip will not start.', e.message);
    }

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

startServer();
