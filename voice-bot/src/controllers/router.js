import { inboundCall, handleStatusCallback, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export async function router(fastify, options) {
  // Use preHandler for Twilio validation
  const authOpts = {
    preHandler: validateTwilioRequest,
  };

  // Regular HTTP routes
  fastify.post('/inbound', authOpts, inboundCall);
  fastify.post('/status-callback', authOpts, handleStatusCallback);

  // WebSocket route for Twilio Media Streams
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
