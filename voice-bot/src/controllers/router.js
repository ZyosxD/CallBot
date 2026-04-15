import { inboundCall, handleWebSocket, handleStatusCallback, outboundTwiml } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // Use preHandler for Twilio validation
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  fastify.post('/inbound/status', handleStatusCallback);

  fastify.get('/outbound/twiml', outboundTwiml);

  // WebSocket route for the Media Stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // Fastify v11 websocket instance extraction
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
