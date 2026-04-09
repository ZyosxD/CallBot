import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Inbound call handler (receptionist)
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // Status callback handler (for outbound to release lock)
  fastify.post('/inbound/status', { preHandler: [validateTwilioRequest] }, inboundStatus);

  // WebSocket endpoint
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // compatibility logic for fastify-websocket v11
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
