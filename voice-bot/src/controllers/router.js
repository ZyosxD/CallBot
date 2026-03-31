import { inboundCall, handleWebSocket, twilioStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status
  // Twilio Call Status Callback endpoint
  fastify.post('/status', twilioStatusCallback);

  // GET /voice/stream
  // WebSocket endpoint for Twilio Media Stream
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
