import { inboundCall, handleWebSocket, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // POST /voice/inbound
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status-callback
  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, statusCallback);

  // WebSocket /voice/stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
