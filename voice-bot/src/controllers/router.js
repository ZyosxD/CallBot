import { inboundCall, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status-callback
  // Does not validate to keep it simple, or we can use the same validation
  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, statusCallback);
}
