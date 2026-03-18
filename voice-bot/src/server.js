import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // We use our own winston logger
});

// Middleware plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Routes
fastify.register(router, { prefix: '/voice' });

// WebSocket Route matching the exact path Twilio expects
fastify.register(async function (fastify) {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    // fastify-websocket v11 passes connection directly
    handleWebSocket(connection, req);
  });
});

// Start server
const PORT = config.server.port || 3000;

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Fastify Server is running on port ${PORT}`);

    // Only start drip if we have a public URL
    if (config.server.publicUrl) {
      startDrip();
    } else {
      logger.warn('Drip service NOT started: PUBLIC_URL is missing in configuration.');
    }

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
