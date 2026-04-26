import { inboundCall, outboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // Inbound call webhook (validated)
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Outbound call webhook (validated)
  fastify.post('/outbound', { preHandler: validateTwilioRequest }, outboundCall);

  // Status callbacks
  fastify.post('/inbound/status', inboundStatus);

  // WebSocket stream (using absolute relative path within the prefix)
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
