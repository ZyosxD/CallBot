import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import logger from './utils/logger.js';
import { handleInboundCall, handleWebSocket, handleCallStatus } from './controllers/callController.js';
import { initScheduler } from './services/scheduler.js';
import { initDataFiles } from './services/leadService.js';

const fastify = Fastify({
  logger: false // We use our own logger
});

// Register plugins
fastify.register(formBody);
fastify.register(websocket);

// Routes
fastify.get('/', async (request, reply) => {
  return { status: 'online', service: 'Voice Bot (Sarah)' };
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// Twilio Webhook for Incoming Calls (Inbound & Outbound TwiML)
fastify.all('/voice/incoming', handleInboundCall);

// Twilio Status Callback
fastify.all('/voice/status', handleCallStatus);

// WebSocket Stream
fastify.register(async function (fastify) {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Start Server
const start = async () => {
  try {
    // Initialize Data Files
    await initDataFiles();

    // Start Server
    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);

    // Initialize Scheduler (Drip Service)
    initScheduler();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
