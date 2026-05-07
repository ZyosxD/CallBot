import { inboundCall, handleWebSocket, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {

  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // Note: For fastify websocket, the path is relative to the router prefix
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
