import { inboundCall, handleWebSocket, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Setup the websocket route first
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });

  // Then the POST routes
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, statusCallback);
}
