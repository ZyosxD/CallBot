import { inboundCall, inboundStatus, outboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // Add preHandler for validation to specific routes
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);
  fastify.post('/outbound/status', { preHandler: validateTwilioRequest }, outboundStatus);

  // WebSocket route relative to the prefix (so it resolves to /voice/stream)
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
