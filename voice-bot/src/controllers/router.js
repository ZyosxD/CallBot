import { inboundCall, handleWebSocket, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WebSocket /voice/stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // According to memory, fastify-websocket v11 needs safely extracting the socket
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
