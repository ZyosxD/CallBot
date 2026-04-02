import { inboundCall, outboundCall, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);
  fastify.post('/outbound', { preHandler: validateTwilioRequest }, outboundCall);
  fastify.post('/statusCallback', statusCallback);
}
