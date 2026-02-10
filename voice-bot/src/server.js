import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import formbody from '@fastify/formbody';
import { config } from './config/config.js';
import logger from './utils/logger.js';
import { incomingCall, outboundTwiml, handleWebSocket, callStatus } from './controllers/callController.js';
import { initScheduler } from './services/scheduler.js';
import { validateTwilioRequest } from './utils/twilioValidator.js';

const fastify = Fastify({ logger: true });

// Register plugins
fastify.register(websocket);
fastify.register(formbody);

// Routes
fastify.get('/', async (request, reply) => {
  return { hello: 'world' };
});

// Incoming Call (Twilio Voice Webhook)
fastify.all('/voice/incoming', { preHandler: validateTwilioRequest }, incomingCall);

// Outbound TwiML (for Drip calls)
fastify.all('/voice/outbound-twiml', { preHandler: validateTwilioRequest }, outboundTwiml);

// Status Callback (Twilio Status)
fastify.all('/voice/status', { preHandler: validateTwilioRequest }, callStatus);

// WebSocket Stream
fastify.register(async (fastify) => {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server listening on ${fastify.server.address().port}`);

    // Initialize Scheduler
    initScheduler();

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
