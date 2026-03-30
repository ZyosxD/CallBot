import { inboundCall, handleWebSocket, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/statusCallback
  // Handles call state updates (e.g. call completed) for outbound drips
  fastify.post('/statusCallback', statusCallback);

  // WebSocket route for the Twilio media stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // fastify-websocket v11 injects socket via connection.socket
    const socket = connection.socket ? connection.socket : connection;
    handleWebSocket(socket, req);
  });
}
