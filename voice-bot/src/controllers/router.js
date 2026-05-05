import { inboundCall, outboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, opts) {
  // Regular HTTP routes
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);
  fastify.post('/outbound', { preHandler: [validateTwilioRequest] }, outboundCall);
  fastify.post('/inbound/status', { preHandler: [validateTwilioRequest] }, inboundStatus);

  // WebSocket route for Twilio Media Streams
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
