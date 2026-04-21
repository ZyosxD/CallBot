import { inboundCall, outboundCall, callStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function routes(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/outbound
  // Returns TwiML for outbound calls started by Smart Drip
  fastify.post('/outbound', { preHandler: [validateTwilioRequest] }, outboundCall);

  // POST /voice/status
  // Receives Twilio status callbacks to release drip concurrency locks
  fastify.post('/status', { preHandler: [validateTwilioRequest] }, callStatus);
}
