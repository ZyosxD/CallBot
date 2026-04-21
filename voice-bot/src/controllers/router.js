import { inboundCall, outboundCallTwiML, handleWebSocket, inboundStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Called by Twilio when a call comes in
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/outbound/twiml
  // Called by Twilio when we initiate an outbound call
  fastify.post('/outbound/twiml', { preHandler: [validateTwilioRequest] }, outboundCallTwiML);

  // POST /voice/status
  // Called by Twilio on call status updates
  fastify.post('/status', { preHandler: [validateTwilioRequest] }, inboundStatus);

  // GET /voice/stream
  // WebSocket endpoint for real-time audio
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // Fastify v11 safely extracting socket
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
