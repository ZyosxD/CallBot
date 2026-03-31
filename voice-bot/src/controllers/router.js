import { inboundCall, outboundCall, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { markCallEnded } from '../services/dripService.js';
import logger from '../utils/logger.js';

export default async function routes(fastify, options) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // Expose outbound TwiML generator for Twilio calls.create
  fastify.post('/outbound', { preHandler: validateTwilioRequest }, outboundCall);

  // Status callback for Twilio outbound calls
  fastify.post('/status', async (request, reply) => {
    logger.info(`Twilio call status update: ${request.body.CallStatus} for SID: ${request.body.CallSid}`);
    markCallEnded(request.body.CallSid);
    return reply.send({ received: true });
  });

  // WebSocket route for the Twilio Media Stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}
