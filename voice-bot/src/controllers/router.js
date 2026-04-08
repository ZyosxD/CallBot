import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Status callback to release lock
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WebSocket stream endpoint
  fastify.get('/stream', { websocket: true }, (connection, request) => {
    // fastify/websocket v11 needs connection.socket for standard WS compatibility
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, request);
  });
}
