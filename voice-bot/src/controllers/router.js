import { inboundCall, outboundCall, outboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  // Use preHandler for Twilio validation

  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  fastify.post('/outbound', { preHandler: [validateTwilioRequest] }, outboundCall);

  fastify.post('/outbound/status', outboundStatus);

  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // fastify/websocket v11 exposes connection.socket
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
