import { inboundCall, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);
  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, statusCallback);
}
