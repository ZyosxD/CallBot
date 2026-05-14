import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  // Tracks call status updates (like completed/failed)
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WS /voice/stream
  // The relative path based on the router prefix /voice
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // fastify-websocket v11 specific
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
