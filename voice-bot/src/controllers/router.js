import { inboundCall, handleWebSocket, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  // Validates Twilio signature and processes call status updates
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // GET /voice/stream
  // WebSocket endpoint for Twilio Media Streams
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // @fastify/websocket v11 provides connection.socket or connection directly depending on the signature used.
    // The handler receives `connection` which is a socket wrapper. We extract `.socket` or use it directly.
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
