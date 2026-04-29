import { inboundCall, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, opts) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // Status callback for inbound/outbound calls
  fastify.post('/inbound/status', async (request, reply) => {
      // Import here to avoid circular dependency if callController depends on dripService
      const { inboundStatus } = await import('./callController.js');
      return inboundStatus(request, reply);
  });

  // WebSocket route
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // Safely extract the socket based on fastify-websocket version
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
