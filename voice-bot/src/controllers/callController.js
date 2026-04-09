import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const callerId = req.query?.callerId || req.body?.From || 'unknown';

    const response = new VoiceResponse();
    const connect = response.connect();

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (req, res) => {
    try {
        const { CallSid, CallStatus } = req.body || {};
        logger.info(`Status Callback received. SID: ${CallSid}, Status: ${CallStatus}`);

        const terminalStates = ['completed', 'busy', 'failed', 'no-answer', 'canceled'];
        if (terminalStates.includes(CallStatus)) {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(CallSid);
        }
        res.status(200).send('OK');
    } catch (e) {
        logger.error('Error handling inbound status:', e);
        res.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound'; // default mode

  const openAIService = new OpenAIRealtimeService(ws);
  openAIService.connect();

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters injected into the stream by TwiML
        if (data.start.customParameters) {
            callerId = data.start.customParameters.callerId || callerId;
            mode = data.start.customParameters.mode || mode;
        }

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }

    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    } catch (e) {
        logger.error('Error ending call dynamically:', e);
    }
  });
};
