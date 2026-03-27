import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Use `preHandler` in Fastify to inject validation
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  fastify.post('/status-callback', handleStatusCallback);

  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
