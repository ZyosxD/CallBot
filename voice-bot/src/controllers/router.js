import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/status
  // Receives Twilio status callbacks
  fastify.post('/status', handleStatusCallback);

  // WEBSOCKET /voice/stream
  // Note: the route inside the router is just '/stream' as we use prefix '/voice'
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
