import { inboundCall, handleWebSocket, outboundCall, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/outbound
  // Same logic as inbound but handles the outbound specific parameters
  fastify.post('/outbound', { preHandler: validateTwilioRequest }, outboundCall);

  // POST /voice/inbound/status
  // Twilio status callbacks
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WEBSOCKET /voice/stream
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
