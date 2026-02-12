import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import logger from './utils/logger.js';
import { startScheduler } from './services/scheduler.js';
import { handleInboundCall, handleOutboundTwiml, handleStatusCallback, handleWebSocket } from './controllers/callController.js';

const fastify = Fastify({ logger: true });

// Plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Routes
fastify.post('/voice/inbound', handleInboundCall);
fastify.post('/voice/outbound-twiml', handleOutboundTwiml);
fastify.post('/voice/status', handleStatusCallback);

fastify.register(async function (fastify) {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Start Server
const start = async () => {
  try {
    if (!config.server.publicUrl) {
      logger.warn('WARNING: PUBLIC_URL is not set. Outbound calls will fail.');
    }

    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);

    // Start Scheduler
    startScheduler();

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
