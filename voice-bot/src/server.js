import fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { startDrip, stopDrip } from './services/dripService.js';
import logger from './utils/logger.js';

const app = fastify({ logger: false });

// Register plugins
app.register(formbody);
app.register(websocket);

// Register routes
app.register(router, { prefix: '/voice' });

// Graceful shutdown handling
app.addHook('onClose', (instance, done) => {
  logger.info('Server shutting down. Stopping Smart Drip Service.');
  stopDrip();
  done();
});

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Start server
const PORT = config.server.port;
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Fastify server is running on port ${PORT}`);

    // Start the Smart Drip Campaign
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
