import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = Fastify({
  logger: false // Use custom winston logger exclusively
});

// Middleware
app.register(formBody);
app.register(fastifyWebsocket);

// Routes
app.register(router, { prefix: '/voice' });

// WebSocket route will be defined in router.js relative to prefix

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown
app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

// Start server
const PORT = config.server.port || 3000;
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
