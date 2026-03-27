import { inboundCall, handleWebSocket, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  fastify.register(async function (childServer) {
    // We add the preHandler to all routes under /voice that need it (just inboundCall, statusCallback)
    childServer.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);
    childServer.post('/status-callback', { preHandler: [validateTwilioRequest] }, statusCallback);

    // Websocket stream route
    childServer.get('/stream', { websocket: true }, (connection, req) => {
      // Safe extraction for Fastify v11 websocket API
      const ws = connection.socket ? connection.socket : connection;
      handleWebSocket(ws, req);
    });
  }, { prefix: '/voice' });
}
