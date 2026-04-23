import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Status callback for Twilio to release locks
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WebSocket endpoint
  fastify.get('/stream', { websocket: true }, (connection, request) => {
    // Extract native WebSocket based on @fastify/websocket version
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, request);
  });
}
