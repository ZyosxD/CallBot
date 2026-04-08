import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/inbound/status
  fastify.post('/inbound/status', inboundStatus);

  // GET /voice/stream (WebSocket)
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection.socket ? connection.socket : connection, req);
  });
}
