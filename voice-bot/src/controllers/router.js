import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  // Twilio status callback
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WebSocket route
  fastify.get('/stream', { websocket: true }, (connection, request) => {
      // safely extracting the WebSocket instance in the handler
      const ws = connection.socket ? connection.socket : connection;
      handleWebSocket(ws, request);
  });
}
