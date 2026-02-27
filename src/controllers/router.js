import { inboundCall, callStatusCallback, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, opts) {

  // POST /voice/inbound
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status-callback
  fastify.post('/status-callback', { preHandler: validateTwilioRequest }, callStatusCallback);

  // WebSocket Route
  fastify.get('/stream', { websocket: true }, (connection, req) => {
      handleWebSocket(connection, req);
  });
}
