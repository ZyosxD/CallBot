import logger from '../utils/logger.js';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';

export async function handleInboundCall(request, reply) {
  logger.info(`Received inbound call`);
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
      <Connect>
          <Stream url="wss://${request.headers.host}/voice/stream">
              <Parameter name="mode" value="inbound" />
          </Stream>
      </Connect>
  </Response>`;
  reply.type('text/xml').send(twiml);
}

export async function handleOutboundCall(request, reply) {
  logger.info(`Received outbound call Webhook`);
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
      <Connect>
          <Stream url="wss://${request.headers.host}/voice/stream">
              <Parameter name="mode" value="outbound" />
          </Stream>
      </Connect>
  </Response>`;
  reply.type('text/xml').send(twiml);
}

export async function inboundStatus(request, reply) {
  const callStatus = request.body.CallStatus;
  const callSid = request.body.CallSid;
  logger.info(`Call Status Update: ${callSid} is now ${callStatus}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      try {
          const { markCallEnded } = await import('../services/dripService.js');
          markCallEnded(callSid);
      } catch (err) {
          logger.error('Error releasing lock from status callback:', err);
      }
  }
  reply.send({ status: 'ok' });
}

export async function handleWebSocket(connection, request) {
  logger.info('New WebSocket connection established');
  const socket = connection.socket ? connection.socket : connection;

  const callerId = request.query?.callerId || request.body?.From || 'unknown';
  let callSid = 'unknown';

  const openaiService = new OpenAIRealtimeService(socket, callSid, callerId);
  await openaiService.connect();

  socket.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.event === 'start') {
        callSid = msg.start.callSid;
        openaiService.callSid = callSid;
        const mode = msg.start.customParameters?.mode || 'inbound';
        logger.info(`Stream started for CallSid: ${callSid}, Mode: ${mode}, CallerId: ${callerId}`);
        openaiService.setMode(mode);
        openaiService.handleTwilioMedia(msg);
      } else if (msg.event === 'media') {
        openaiService.handleTwilioMedia(msg);
      } else if (msg.event === 'stop') {
        logger.info(`Stream stopped for CallSid: ${callSid}`);
      }
    } catch (e) {
      logger.error('Error processing websocket message:', e);
    }
  });

  socket.on('close', async () => {
    logger.info(`WebSocket closed for CallSid: ${callSid}`);
    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    } catch (err) {
        logger.error('Error releasing lock on socket close:', err);
    }
  });
}
