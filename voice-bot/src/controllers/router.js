import { inboundCall, outboundCall, callStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { handleWebSocket } from './callController.js';

export default async function router(fastify, options) {
  // Validate Twilio signature for inbound calls
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // Generate TwiML for outbound calls
  fastify.post('/outbound', outboundCall);

  // Status callback for calls
  fastify.post('/status', callStatus);

  // WebSocket route for the Realtime stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // Fastify-websocket v11 uses connection.socket
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
