import twilio from 'twilio';
import logger from '../utils/logger.js';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    const callerId = request.query?.callerId || request.body?.From || 'unknown';
    const isOutbound = !!request.query?.callerId;
    const mode = isOutbound ? 'outbound' : 'inbound';

    logger.info(`Call received (Mode: ${mode}) from ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
      name: JSON.stringify({ mode, callerId }) // pass state
    });

    return reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    try {
        const callSid = request.body.CallSid;
        const callStatus = request.body.CallStatus;

        logger.info(`Call Status Update - Sid: ${callSid}, Status: ${callStatus}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
             const { markCallEnded } = await import('../services/dripService.js');
             markCallEnded(callSid);
        }
        return reply.code(200).send('OK');
    } catch(err) {
        logger.error('Error handling status callback:', err);
        return reply.code(500).send('Internal Server Error');
    }
};


export const handleWebSocket = (connection, req) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  let openAIService = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        let streamNameData = { mode: 'inbound', callerId: 'unknown' };
        try {
           if (data.start.customParameters && data.start.customParameters.name) {
                streamNameData = JSON.parse(data.start.customParameters.name);
           } else if (data.start.streamName) { // Fallback standard parsing
                streamNameData = JSON.parse(data.start.streamName);
           }
        } catch(e) {}

        openAIService = new OpenAIRealtimeService(ws, streamNameData.mode, streamNameData.callerId);
        await openAIService.connect();

        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped`);
        if (openAIService?.callSid) {
             const { markCallEnded } = await import('../services/dripService.js');
             markCallEnded(openAIService.callSid);
        }
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    if (openAIService) {
        if (openAIService.openaiWs) {
            openAIService.openaiWs.close();
        }
        if (openAIService.callSid) {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(openAIService.callSid);
        }
    }
  });
};
