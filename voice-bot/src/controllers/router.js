import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  // Twilio status callback to release locks
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // GET /voice/stream
  // WebSocket route for the audio stream
  fastify.get('/stream', { websocket: true }, (connection, request) => {
    handleWebSocket(connection, request);
  });
}
