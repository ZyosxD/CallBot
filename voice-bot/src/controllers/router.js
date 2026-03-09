import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Inbound call webhook (receives POST from Twilio when a call comes in)
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Status callback webhook (receives POST from Twilio when a call status changes)
  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, handleStatusCallback);

  // WebSocket endpoint for the Twilio media stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // In @fastify/websocket v11+, pass `connection` directly if the handler expects raw ws methods
    // However, it is usually safer to pass the underlying socket depending on the implementation.
    // Assuming `handleWebSocket` expects `ws` object
    handleWebSocket(connection, req);
  });
}
