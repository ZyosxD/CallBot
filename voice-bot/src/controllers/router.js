import { inboundCall, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { handleWebSocket } from './callController.js';

export default async function (fastify, opts) {
  // POST /voice/inbound
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WEBSOCKET /voice/stream
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
