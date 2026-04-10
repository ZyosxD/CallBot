import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = Fastify({ logger: false });

// Middleware
app.register(fastifyFormbody);
app.register(fastifyWebsocket);

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Something broke!' });
});

// Routes
app.register(router, { prefix: '/voice' });

// WebSocket handling
app.register(async function (fastify) {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    // Extract socket for @fastify/websocket v11
    const socket = connection.socket ? connection.socket : connection;
    handleWebSocket(socket, req);
  });
});

// Graceful shutdown
app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
