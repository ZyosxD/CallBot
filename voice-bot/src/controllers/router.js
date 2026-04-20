import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  // Use preHandler for Twilio validation
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Status callback for inbound/outbound calls
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);
  fastify.post('/outbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WebSocket endpoint
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
