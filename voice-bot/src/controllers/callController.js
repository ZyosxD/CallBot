import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Call handler triggered');
    const response = new VoiceResponse();

    // Determine callerId. For inbound it's req.body.From. For outbound it's passed in query.
    const callerId = req.query.callerId || ((req.body && req.body.From) ? req.body.From : 'unknown');

    // Determine mode based on presence of query param (from drip service)
    const mode = req.query.callerId ? 'outbound' : 'inbound';

    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // Pass custom parameters to the WebSocket via Twilio Start event
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: mode });

    // Assuming we're returning directly from fastify route, use fastify reply syntax
    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  // Create an uninitialized service
  const openAIService = new OpenAIRealtimeService(ws);
  // Do NOT connect here to prevent race conditions. Wait for start event.
  let isTwilioStarted = false;
  let isOpenAiConnected = false;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom params
        if (data.start.customParameters) {
           callerId = data.start.customParameters.callerId || 'unknown';
           mode = data.start.customParameters.mode || 'inbound';
        }

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        isTwilioStarted = true;

        // Connect to OpenAI now that we have the parameters
        openAIService.connect().then(() => {
          isOpenAiConnected = true;
          openAIService.checkAndInitializeSession(isTwilioStarted, isOpenAiConnected);
        });

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
    if (openAIService.openaiWs && openAIService.openaiWs.readyState === 1) { // 1 = OPEN
        openAIService.openaiWs.close();
    }

    // Always release lock on ws close to prevent deadlock
    if (callSid !== 'unknown') {
      import('../services/dripService.js').then(({ markCallEnded }) => {
        markCallEnded(callSid);
      }).catch(err => logger.error('Error importing markCallEnded', err));
    }
  });
};

export const inboundStatus = (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;

    logger.info(`Call ${callSid} status changed to ${callStatus}`);

    // If call ended in any way (completed, failed, busy, no-answer, canceled)
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
        import('../services/dripService.js').then(({ markCallEnded }) => {
            markCallEnded(callSid);
        }).catch(err => logger.error('Error importing markCallEnded', err));
    }

    res.type('text/xml');
    res.send('<Response></Response>');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    res.status(500).send('Internal Server Error');
  }
};
