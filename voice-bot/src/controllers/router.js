import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);
  fastify.post('/inbound/status', inboundStatus);

  fastify.get('/stream', { websocket: true }, (connection, request) => {
    handleWebSocket(connection, request);
  });
}
