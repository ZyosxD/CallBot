import { inboundCall, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/status-callback
  // Webhook for Twilio to send call status updates (used for Smart Drip)
  fastify.post('/status-callback', { preHandler: [validateTwilioRequest] }, handleStatusCallback);
}
