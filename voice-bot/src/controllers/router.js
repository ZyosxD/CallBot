import { inboundCall, outboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Validate Twilio signature for these routes
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);
  fastify.post('/outbound', { preHandler: validateTwilioRequest }, outboundCall);
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // Define WebSocket route (relative to plugin prefix if any)
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
