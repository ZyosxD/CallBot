import { inboundCall, handleWebSocket, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  fastify.post('/inbound/status', inboundStatus);

  // GET /voice/stream (WebSocket)
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // fastify-websocket v11 has socket on connection.socket or connection directly
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
