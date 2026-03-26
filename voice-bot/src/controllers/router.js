import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status-callback
  // Handle call status updates
  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, handleStatusCallback);

  // GET /voice/stream (WebSocket)
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // Extract WebSocket correctly depending on @fastify/websocket version
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
