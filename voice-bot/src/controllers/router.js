import { handleWebSocket, inboundCall } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

  // POST /voice/statusCallback
  // Handles Twilio call status events
  fastify.post('/statusCallback', async (request, reply) => {
    const { CallSid, CallStatus } = request.body;
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(CallSid);
    }
    reply.send('OK');
  });

  // WebSocket /voice/stream
  // The stream route is inside the fastify router with /voice prefix
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    // Extract WS instance correctly for @fastify/websocket v11
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, req);
  });
}
