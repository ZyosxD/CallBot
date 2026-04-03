import { inboundCall, handleTwilioStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/status
  // Receives status callbacks from Twilio for outbound calls
  fastify.post('/status', handleTwilioStatus);
}
