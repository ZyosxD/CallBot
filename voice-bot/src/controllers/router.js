import { inboundCall, statusCallback, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // We apply the twilio validator to routes that receive POST from Twilio

  fastify.post('/voice/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  fastify.post('/voice/status-callback', { preHandler: [validateTwilioRequest] }, statusCallback);

  // Note: For fastify-websocket, we define the full path directly on fastify
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection.socket, req);
  });
}
