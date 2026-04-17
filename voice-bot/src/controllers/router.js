import { inboundCall, inboundStatus, outboundStatus, handleWebSocketStream } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Status webhooks to unlock smart drip queue
  fastify.post('/inbound/status', inboundStatus);
  fastify.post('/outbound/status', outboundStatus);

  // Stream route must be defined relative to the prefix
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocketStream(connection, req);
  });
}