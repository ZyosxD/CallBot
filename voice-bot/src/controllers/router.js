import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);
  fastify.post('/inbound/status', { preHandler: [validateTwilioRequest] }, inboundStatus);
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
