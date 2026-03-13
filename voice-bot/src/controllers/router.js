import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/voice/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/status-callback
  fastify.post('/voice/status-callback', { preHandler: [validateTwilioRequest] }, handleStatusCallback);

  // GET /voice/stream
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
