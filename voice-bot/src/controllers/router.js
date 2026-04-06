import { handleInbound, handleOutboundStatus, handleInboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Inbound Call Webhook
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, handleInbound);

  // Twilio Status Callbacks
  fastify.post('/inbound/status', handleInboundStatus);
  fastify.post('/outbound/status', handleOutboundStatus);

  // WebSocket Route for Twilio Media Stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
