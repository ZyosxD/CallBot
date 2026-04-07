import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  // Handles Twilio status callbacks to release outbound locks
  fastify.post('/inbound/status', inboundStatus);

  // GET /voice/stream (WebSocket)
  // Handles the real-time audio stream
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
