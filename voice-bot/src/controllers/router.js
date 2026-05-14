import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/outbound
  // Similar to inbound but initiated from our server
  fastify.post('/outbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/inbound/status
  // Status callback from Twilio
  fastify.post('/inbound/status', inboundStatus);

  // GET /voice/stream
  // WebSocket connection for OpenAI Realtime
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
