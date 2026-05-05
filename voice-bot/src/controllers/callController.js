import twilio from 'twilio';
import logger from '../utils/logger.js';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { config } from '../config/config.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const outboundCall = (req, res) => {
  try {
    const callerId = req.query.callerId || '';
    logger.info(`Outbound TwiML requested for callerId: ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: 'outbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error generating outbound TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const inboundCall = (req, res) => {
  try {
    const callerId = req.body?.From || 'unknown';
    logger.info(`Incoming call received from: ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = (req, res) => {
  try {
    const callSid = req.body?.CallSid;
    const callStatus = req.body?.CallStatus;
    logger.info(`Call status update for ${callSid}: ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      markCallEnded(callSid);
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling call status:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection established');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters passed from TwiML
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || callerId;
          mode = data.start.customParameters.mode || mode;
        }

        logger.info(`Stream started for CallSid: ${callSid}, Mode: ${mode}, CallerId: ${callerId}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stop event received for call ${callSid}`);
        if (openAIService) {
          openAIService.handleTwilioMedia(data); // to trigger stop logic and markCallEnded
        } else {
          markCallEnded(callSid);
        }
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', async () => {
    logger.info(`WebSocket connection closed for call ${callSid}`);
    // Dynamic import to break dependency cycle issues in some setups if needed
    const { markCallEnded: markEnded } = await import('../services/dripService.js');
    markEnded(callSid);

    if (openAIService && openAIService.openaiWs && openAIService.openaiWs.readyState === 1) {
        openAIService.openaiWs.close();
    }
  });
};
