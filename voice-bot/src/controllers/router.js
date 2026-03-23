import { inboundCall, handleWebSocket, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function (fastify, opts) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status-callback
  // Validates Twilio signature and receives status updates for Drip calls
  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, statusCallback);

  // WebSocket route needs to match the exact URL requested by Twilio Media Streams
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection.socket, req);
  });
}
