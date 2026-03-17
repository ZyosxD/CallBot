import { inboundCall, handleWebSocket, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/status-callback
  // Status callback for Twilio outbound calls
  fastify.post('/status-callback', { preHandler: [validateTwilioRequest] }, statusCallback);

  // GET /voice/stream
  // WebSocket endpoint for Twilio Media Streams
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
