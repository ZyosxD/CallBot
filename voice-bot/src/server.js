import fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const app = fastify({ logger: false }); // We use our own winston logger

// Register plugins
app.register(fastifyFormbody);
app.register(fastifyWebsocket, {
  options: { maxPayload: 1048576 }
});

// Register routes
app.register(router, { prefix: '/voice' });

// WebSocket handling
app.register(async (fastifyInstance) => {
  fastifyInstance.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection.socket, req);
  });
});

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

const startServer = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Check public URL for outbound/drip capabilities
    if (!config.server.publicUrl) {
      logger.warn('WARNING: config.server.publicUrl is not set. Drip Service cannot start and Twilio Validation may fail.');
    } else {
      startDrip();
    }

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

startServer();
