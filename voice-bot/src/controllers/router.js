import { inboundCall, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Validate Twilio signature via a preHandler for the specific routes
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Status callback does not need strict validation in this implementation, but can use it if desired.
  fastify.post('/status-callback', handleStatusCallback);
}
