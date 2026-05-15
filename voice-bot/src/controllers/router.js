import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { inboundCall, handleWebSocket, inboundStatus } from './callController.js';

export default async function router(fastify, options) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
