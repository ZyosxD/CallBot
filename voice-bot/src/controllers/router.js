import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Also we might need an outbound/status callback for the drip service to mark calls as ended
  fastify.post('/inbound/status', inboundStatus);

  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
