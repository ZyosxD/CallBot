import { handleWebSocket, inboundCall, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/inbound/status
  fastify.post('/inbound/status', { preHandler: [validateTwilioRequest] }, inboundStatus);

  // WebSocket for real-time audio streaming
  fastify.get('/stream', { websocket: true }, (connection, req) => {
      // Safely extract the websocket instance
      const ws = connection.socket ? connection.socket : connection;
      handleWebSocket(ws, req);
  });
}
