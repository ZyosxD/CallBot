import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = Fastify({ logger: false });

// Register plugins
await app.register(fastifyFormbody);
await app.register(fastifyWebsocket);

// Register routes
await app.register(router, { prefix: '/voice' });

// Graceful shutdown hook
app.addHook('onClose', async (instance, done) => {
  logger.info('Server shutting down. Stopping Smart Drip...');
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the Smart Drip campaign after successful start
    startDrip();

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
