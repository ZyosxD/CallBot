import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);
  fastify.post('/inbound/status', inboundStatus);
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
