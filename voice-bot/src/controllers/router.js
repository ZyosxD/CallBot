import { inboundCall, handleTwilioStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status-callback
  // Status callback handler to maintain locking in Smart Drip engine
  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, handleTwilioStatusCallback);
}
