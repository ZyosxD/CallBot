import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // Pass custom parameters
    stream.parameter({ name: 'mode', value: 'SARAH_INBOUND' });
    stream.parameter({ name: 'callerId', value: req.body.From || 'unknown' });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (req, res) => {
  try {
    const callStatus = req.body.CallStatus;
    const callSid = req.body.CallSid;

    logger.info(`Call ${callSid} status updated to: ${callStatus}`);

    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'canceled') {
        import('../services/dripService.js').then(({ onCallEnded }) => {
            onCallEnded();
        });
    }

    res.sendStatus(200);
  } catch (error) {
    logger.error('Error handling status callback:', error);
    res.sendStatus(500);
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  // We can extract CallSid from the query params if we added it in the TwiML url
  // or wait for the 'start' event from Twilio.
  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;
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

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
