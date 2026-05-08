import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, options) {
  // Validate Twilio requests middleware
  fastify.addHook('preHandler', async (request, reply) => {
    // We only want to validate Twilio requests on /voice/inbound and /voice/inbound/status
    if (request.url.startsWith('/voice/inbound')) {
      await validateTwilioRequest(request, reply);
    }
  });

  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', inboundCall);

  // POST /voice/inbound/status
  fastify.post('/inbound/status', inboundStatus);

  // WebSocket route /voice/stream
  // Handled relative to the prefix (/voice) -> so it's /stream
  fastify.get('/stream', { websocket: true }, (connection, request) => {
    // Support @fastify/websocket v11
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, request);
  });
}
