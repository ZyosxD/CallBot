import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import validateTwilioRequest from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // We apply the twilio validator to incoming Twilio requests
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Status webhook for both inbound and outbound to handle lock release
  fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);
  fastify.post('/outbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

  // WebSocket route for the media stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
