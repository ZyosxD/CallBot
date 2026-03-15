import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Use custom logger instead
});

// Register plugins
fastify.register(formbody);
fastify.register(fastifyWebsocket);

// Startup check
if (!config.server.publicUrl) {
  logger.warn('config.server.publicUrl is not set. Drip Service will not be started properly.');
}

// Routes registration
fastify.register(async function (fastify) {
  // Pass fastify instance to router so it can define routes
  fastify.register(router, { prefix: '/voice' });

  // WebSocket handling - must match the full URL path requested by Twilio
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Error handling
fastify.setErrorHandler(function (error, request, reply) {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Smart Drip Engine if PUBLIC_URL is set
    if (config.server.publicUrl) {
      logger.info('Starting Smart Drip Engine...');
      startDrip();
    }
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
