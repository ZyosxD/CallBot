import { inboundCall, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status-callback
  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, statusCallback);
}
