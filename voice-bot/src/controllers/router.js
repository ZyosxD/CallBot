import { inboundCall, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import logger from '../utils/logger.js';

export default async function router(fastify, options) {
  // POST /voice/inbound
  // Validates Twilio signature and returns TwiML to connect to WebSocket
  fastify.post('/inbound', { preHandler: [validateTwilioRequest] }, inboundCall);

  // POST /voice/outbound/status
  // Twilio webhook to handle call statuses and release locks
  fastify.post('/outbound/status', async (request, reply) => {
    try {
        const callStatus = request.body?.CallStatus;
        const callSid = request.body?.CallSid;
        logger.info(`Outbound status update: ${callSid} is ${callStatus}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
             const { markCallEnded } = await import('../services/dripService.js');
             markCallEnded(callSid);
        }
        return reply.code(200).send('OK');
    } catch (e) {
        logger.error('Error handling outbound status', e);
        return reply.code(500).send('Internal Server Error');
    }
  });

  // WebSocket /voice/stream
  fastify.get('/stream', { websocket: true }, (connection, request) => {
    // fastify-websocket v11 has connection.socket
    const ws = connection.socket ? connection.socket : connection;
    handleWebSocket(ws, request);
  });
}