import { inboundCall, handleWebSocket, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  fastify.post('/status', statusCallback);

  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // fastify-websocket v11 provides socket on connection.socket
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
