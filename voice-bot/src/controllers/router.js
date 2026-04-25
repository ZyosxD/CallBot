import { inboundCall, handleWebSocket, callStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // Setup Twilio Signature Validation on incoming POST routes
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);
  fastify.post('/status', { preHandler: [validateTwilioRequest] }, callStatus);

  // WebSocket endpoint for TwiML stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // fastify-websocket v11 exposes the raw socket under connection.socket or connection directly
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
