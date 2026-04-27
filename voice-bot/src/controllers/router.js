import { inboundCall, outboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {

  // Apply Twilio validation preHandler
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);
  fastify.post('/outbound', { preHandler: [validateTwilioRequest] }, outboundCall);
  fastify.post('/status', { preHandler: [validateTwilioRequest] }, inboundStatus);

  // WebSocket route relative to the /voice prefix
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
