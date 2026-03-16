import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  // Use preHandler for Twilio validation
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, handleStatusCallback);

  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
