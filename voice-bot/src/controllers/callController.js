import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { handleCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    // Use config.server.publicUrl to construct WebSocket URL
    const publicUrl = new URL(config.server.publicUrl);
    const wsUrl = `wss://${publicUrl.host}/voice/stream`;

    const stream = connect.stream({
      url: wsUrl,
    });

    // Pass callerId
    stream.parameter({
        name: 'callerId',
        value: req.body.From
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const outboundTwiml = (req, res) => {
  try {
    const name = req.query.name || 'Valued Customer';
    const response = new VoiceResponse();
    const connect = response.connect();

    const publicUrl = new URL(config.server.publicUrl);
    const wsUrl = `wss://${publicUrl.host}/voice/stream`;

    const stream = connect.stream({
        url: wsUrl,
    });

    // Pass custom parameters to the stream
    stream.parameter({
        name: 'callerId',
        value: req.body.To // The number we called
    });
    stream.parameter({
        name: 'name',
        value: name
    });

    // We can also say something initially, but usually the stream starts immediately.
    // response.say(`Hello ${name}, this is Sarah.`);
    // Ideally, the AI speaks first.

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error generating outbound TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const statusCallback = (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;

    logger.info(`Call ${callSid} status update: ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        handleCallEnded(callSid);
    }

    res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        logger.info(`Stream started for call ${callSid}`);

        openAIService = new OpenAIRealtimeService(ws, callSid);

        // Extract custom parameters
        if (data.start.customParameters) {
            if (data.start.customParameters.callerId) {
                openAIService.callerId = data.start.customParameters.callerId;
            }
        }

        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media' && openAIService) {
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
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService) {
        if (openAIService.openaiWs) {
            openAIService.openaiWs.close();
        }
    }
  });
};
