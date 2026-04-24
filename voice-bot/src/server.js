import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';

const fastify = Fastify({ logger: false });

// Register plugins
await fastify.register(fastifyFormbody);
await fastify.register(fastifyWebsocket);

// Register routes
await fastify.register(router, { prefix: '/voice' });

// Graceful Shutdown
const shutdown = async (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    await fastify.close();
    logger.info('Server closed.');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

fastify.addHook('onClose', async (instance, done) => {
    try {
        const { stopDrip } = await import('./services/dripService.js');
        stopDrip();
        logger.info('Drip campaign stopped.');
    } catch (e) {
        logger.error('Error stopping drip campaign', e);
    }
    done();
});


// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Drip Campaign
    const { startDrip } = await import('./services/dripService.js');
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
