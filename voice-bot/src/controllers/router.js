import { inboundCall, handleWebSocket, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/outbound/status
  // Handles Twilio status callbacks for outbound calls
  fastify.post('/outbound/status', inboundStatus);

  // GET /voice/stream
  // WebSocket endpoint
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // fastify-websocket v11 specific
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
