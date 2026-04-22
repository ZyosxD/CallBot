import { inboundCall, handleWebSocket, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  fastify.post('/inbound/status', inboundStatus);

  // WebSocket route for Twilio Media Streams
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // Extract actual WebSocket instance
    const ws = connection.socket || connection;
    handleWebSocket(ws, req);
  });
}
