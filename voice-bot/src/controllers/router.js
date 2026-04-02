import { inboundCall, outboundTwiml, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { markCallEnded } from '../services/dripService.js';

export default async function router(fastify, options) {
  // Inbound Call Webhook
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // Outbound TwiML Generator
  fastify.post('/outbound-twiml', outboundTwiml);

  // Status Callback for Outbound Calls
  fastify.post('/status', async (request, reply) => {
    const callStatus = request.body.CallStatus;
    const callSid = request.body.CallSid;

    if (['completed', 'failed', 'canceled', 'busy', 'no-answer'].includes(callStatus)) {
        markCallEnded(callSid);
    }
    reply.send('OK');
  });

  // WebSocket Route
  // The route is prefixed with /voice in server.js, so this is /voice/stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}