import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';

export default async function router(fastify, options) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // Define websocket route relative to prefix
  fastify.get('/stream', { websocket: true }, (connection, req) => {
      handleWebSocket(connection, req);
  });
}
