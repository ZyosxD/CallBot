import { inboundCall, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { markCallEnded } from '../services/dripService.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/status
  // Twilio callback for call status
  fastify.post('/status', async (request, reply) => {
      const callStatus = request.body.CallStatus;
      const callSid = request.body.CallSid;

      if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
          markCallEnded(callSid);
      }

      reply.status(200).send('OK');
  });

  // WebSocket /voice/stream
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
