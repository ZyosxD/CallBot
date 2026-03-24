import { inboundCall } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { markCallEnded } from '../services/dripService.js';

export default async function (fastify, opts) {
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, async (request, reply) => {
    inboundCall(request, reply);
  });

  fastify.post('/status-callback', async (request, reply) => {
    const { CallSid, CallStatus } = request.body;
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
      markCallEnded(CallSid);
    }
    reply.status(200).send('OK');
  });
}
