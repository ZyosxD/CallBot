import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import logger from './utils/logger.js';
import { inboundCall, outboundTwiml, callStatus, handleWebSocket } from './controllers/callController.js';
import { startScheduler } from './services/scheduler.js';

const fastify = Fastify({ logger: true });

// Register plugins
fastify.register(formBody);
fastify.register(websocket);

// Routes
fastify.register(async function (fastify) {
  fastify.get('/', async (request, reply) => {
    return { status: 'ok', message: 'Voice Bot is running 🚀' };
  });

  // Twilio Webhooks
  fastify.post('/voice/incoming', inboundCall);
  fastify.post('/voice/outbound-twiml', outboundTwiml);
  fastify.post('/voice/status', callStatus);

  // WebSocket Route
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection.socket, req);
  });
});

// Start server
const start = async () => {
  try {
    const port = config.server.port;
    await fastify.listen({ port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${port}`);

    // Initialize Scheduler
    startScheduler();

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
