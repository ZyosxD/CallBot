import { inboundCall, outboundCall, outboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // We use fastify.route or fastify.post depending on needs.

  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);
  fastify.post('/outbound', { preHandler: validateTwilioRequest }, outboundCall);
  fastify.post('/outbound/status', { preHandler: validateTwilioRequest }, outboundStatus);

  // WebSocket route for the stream
  // Fastify websocket plugin registers on fastify.get
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
