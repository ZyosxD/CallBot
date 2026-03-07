import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import { handleWebSocket, inboundCall, outboundTwiml, statusCallback } from './controllers/callController.js';
import { validateTwilioRequest } from './utils/twilioValidator.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const fastify = Fastify({ logger: false });

fastify.register(fastifyWebsocket);
fastify.register(fastifyFormbody);

fastify.post('/voice/inbound', { preHandler: validateTwilioRequest }, inboundCall);
fastify.post('/voice/outbound-twiml', { preHandler: validateTwilioRequest }, outboundTwiml);
fastify.post('/voice/status-callback', { preHandler: validateTwilioRequest }, statusCallback);

fastify.register(async function (fastify) {
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    // In @fastify/websocket v11, 'connection' is the WebSocket instance
    handleWebSocket(connection, req);
  });
});

const start = async () => {
  try {
    if (!config.server.publicUrl) {
      logger.warn("PUBLIC_URL not set, Smart Drip service will not start.");
    } else {
      startDrip();
    }

    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
