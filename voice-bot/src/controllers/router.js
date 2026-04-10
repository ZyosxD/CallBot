import { inboundCall, outboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket (Inbound)
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/outbound
  // Returns TwiML to connect to WebSocket for Smart Drip Outbound calls
  fastify.post('/outbound', outboundCall);

  // POST /voice/inbound/status
  // Twilio status callback to track call end and release drip locks
  fastify.post('/inbound/status', inboundStatus);

  // GET /voice/stream
  // Handled in server.js directly as a websocket route since websocket routes are defined on the fastify instance
  // fastify.get('/stream', { websocket: true }, (connection, req) => { ... });
}
