import { inboundCall, handleWebSocket, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/inbound/status
  // Handles Twilio status callbacks
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WebSocket route for Twilio media stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // Extract websocket from connection based on fastify-websocket version
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
