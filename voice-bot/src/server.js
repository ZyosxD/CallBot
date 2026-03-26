import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = Fastify({ logger: false });

// Register plugins
app.register(fastifyFormbody);
app.register(fastifyWebsocket);

// Register routes
app.register(router, { prefix: '/voice' });

// Graceful shutdown
app.addHook('onClose', (instance, done) => {
  logger.info('Server shutting down, stopping drip campaign...');
  stopDrip();
  done();
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Initialize the Smart Drip campaign
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
