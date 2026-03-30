import { inboundCall, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { markCallEnded } from '../services/dripService.js';

export default async function (fastify, opts) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // GET /voice/stream (WebSocket)
  fastify.get('/stream', { websocket: true }, handleWebSocket);

  // POST /voice/status (Webhook from Twilio for Drip Call Status)
  fastify.post('/status', (request, reply) => {
    const status = request.body.CallStatus;
    const callSid = request.body.CallSid;

    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status)) {
        markCallEnded(callSid);
    }

    reply.send('OK');
  });
}
