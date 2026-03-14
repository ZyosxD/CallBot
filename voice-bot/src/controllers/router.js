import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  fastify.post('/voice/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/status-callback
  fastify.post('/voice/status-callback', handleStatusCallback);

  // WS /voice/stream
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
