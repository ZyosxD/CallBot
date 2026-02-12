import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWebSocket from '@fastify/websocket';
import { config } from './config/config.js';
import logger from './utils/logger.js';
import { initScheduler } from './services/scheduler.js';
import {
    handleInboundCall,
    handleOutboundTwiML,
    handleCallStatusWebhook,
    handleWebSocket
} from './controllers/callController.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(fastifyFormBody);
fastify.register(fastifyWebSocket);

// Routes
fastify.post('/voice/inbound', handleInboundCall);
fastify.post('/voice/outbound-twiml', handleOutboundTwiML);
fastify.post('/voice/status', handleCallStatusWebhook);

// WebSocket route
fastify.register(async function (fastify) {
  fastify.get('/voice/stream', { websocket: true }, handleWebSocket);
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Initialize Scheduler
    initScheduler();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
