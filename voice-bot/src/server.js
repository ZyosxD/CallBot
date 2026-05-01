import fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = fastify({ logger: false });

// Middleware
app.register(fastifyFormbody);
app.register(fastifyWebsocket);

// Error handling plugin
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Something broke!' });
});

// Routes
app.register(router, { prefix: '/voice' });

// WebSocket handling manually registered on prefix later in router, but we can also set the main stream here or via router.
// However, the router manages HTTP, and fastify-websocket prefers routes. We'll register the websocket route in router.js or inline here.
// But as per instruction: register routes from src/controllers/router.js

// Graceful shutdown
const listeners = ['SIGINT', 'SIGTERM'];
listeners.forEach((signal) => {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, shutting down...`);
    try {
      await app.close();
      logger.info('Server closed gracefully');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', err);
      process.exit(1);
    }
  });
});

app.addHook('onClose', async (instance, done) => {
  try {
    await stopDrip();
    logger.info('Stopped Smart Drip campaign.');
  } catch (err) {
    logger.error('Error stopping drip:', err);
  }
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port || 3000;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Smart Drip
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
