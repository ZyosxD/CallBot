import fastify from 'fastify';
import formBodyPlugin from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import { startDrip } from './services/dripService.js';
import logger from './utils/logger.js';

const app = fastify({ logger: false });

// Register plugins
app.register(formBodyPlugin);
app.register(websocketPlugin);

// Register HTTP routes
app.register(router, { prefix: '/voice' });

// Register WebSocket route
app.register(async (fastify) => {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    if (!config.server.publicUrl) {
      logger.warn('WARNING: PUBLIC_URL is not set. Drip service will not start as it cannot generate absolute TwiML URLs.');
    } else {
      startDrip();
    }
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
