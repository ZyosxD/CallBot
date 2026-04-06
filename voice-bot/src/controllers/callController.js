import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

export const handleInbound = async (request, reply) => {
  const callerId = request.body?.From || 'unknown';
  logger.info(`Incoming call from ${callerId}`);

  const host = request.headers.host;
  const streamUrl = `wss://${host}/voice/stream?mode=inbound&callerId=${encodeURIComponent(callerId)}`;

  const twiml = `
    <Response>
      <Connect>
        <Stream url="${streamUrl}" />
      </Connect>
    </Response>
  `;

  reply.type('text/xml').send(twiml);
};

export const handleInboundStatus = async (request, reply) => {
  const { CallStatus, CallSid } = request.body;
  logger.info(`Inbound call status update: ${CallStatus} for SID: ${CallSid}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
    // Attempt dynamic import as noted in memory to avoid circular deps if needed
    import('../services/dripService.js').then((module) => {
        module.markCallEnded(CallSid);
    }).catch(err => logger.error("Error dynamically importing dripService in inbound status", err));
  }

  reply.send({ success: true });
};

export const handleOutboundStatus = async (request, reply) => {
  const { CallStatus, CallSid } = request.body;
  logger.info(`Outbound call status update: ${CallStatus} for SID: ${CallSid}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
    import('../services/dripService.js').then((module) => {
        module.markCallEnded(CallSid);
    }).catch(err => logger.error("Error dynamically importing dripService in outbound status", err));
  }

  reply.send({ success: true });
};

export const handleWebSocket = (connection, req) => {
  const socket = connection.socket ? connection.socket : connection;
  const mode = req.query?.mode || 'inbound';
  const callerId = req.query?.callerId || 'unknown';

  logger.info(`WebSocket connection established for ${mode} call. Caller ID: ${callerId}`);

  const realtimeService = new OpenAIRealtimeService(socket, null, mode, callerId);
  realtimeService.connect();

  socket.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      realtimeService.handleTwilioMedia(data);
    } catch (error) {
      logger.error('Error parsing Twilio media message:', error);
    }
  });

  socket.on('close', () => {
    logger.info('WebSocket closed');
    if (realtimeService.callSid) {
       import('../services/dripService.js').then((module) => {
            module.markCallEnded(realtimeService.callSid);
       }).catch(err => logger.error("Error dynamically importing dripService on WS close", err));
    }
  });

  socket.on('error', (error) => {
    logger.error('WebSocket Error:', error);
  });
};
