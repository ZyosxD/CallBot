import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  fastify.post('/status-callback', handleStatusCallback);

  fastify.get('/stream', { websocket: true }, (connection, request) => {
    // Extract native websocket
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, request);
  });
}
