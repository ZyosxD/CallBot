import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status-callback
  // Handle call status updates
  fastify.post('/status-callback', handleStatusCallback);

  // GET /voice/stream
  // WebSocket connection for media streaming
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
