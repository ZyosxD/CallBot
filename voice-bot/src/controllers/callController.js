import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    logger.info(`Handling ${mode} call. Caller ID: ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Error generating TwiML');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callSid = request.body?.CallSid;
    const callStatus = request.body?.CallStatus;

    logger.info(`Call Status Update: CallSid ${callSid} is now ${callStatus}`);

    // If call is in a terminal state, ensure lock is released
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      await markCallEnded(callSid);
    }

    reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Error');
  }
}

export const handleWebSocket = (ws, req) => {
  logger.info('WebSocket connection established');

  let openAIService = null;
  let callerId = null;
  let mode = 'inbound';
  let callSid = null;

  let isOpenAiConnected = false;
  let isTwilioStarted = false;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        const streamSid = data.start.streamSid;
        callSid = data.start.callSid;
        const customParams = data.start.customParameters;

        if (customParams) {
          callerId = customParams.callerId;
          if (customParams.mode) {
              mode = customParams.mode;
          }
        }

        logger.info(`Twilio Stream started: ${streamSid}, CallSid: ${callSid}, Mode: ${mode}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        await openAIService.connect();

        // Mark Twilio as started
        isTwilioStarted = true;
        checkAndInitializeSession();

      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info('Twilio Stream stopped');
        if (callSid) {
           await markCallEnded(callSid);
        }
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  const checkAndInitializeSession = () => {
    if (openAIService && openAIService.openaiWs && openAIService.openaiWs.readyState === 1) {
       isOpenAiConnected = true;
    }
    if (isOpenAiConnected && isTwilioStarted && openAIService) {
       logger.info('Both OpenAI and Twilio are ready. Initializing session.');
       openAIService.sendSessionUpdate();

       // Only trigger session update once
       isOpenAiConnected = false;
       isTwilioStarted = false;
    }
  }

  // Set up listener for when OpenAI WS opens to potentially trigger the session initialization
  // Note: this hook requires a minor refactor in openaiRealtime.js to emit an event or we check periodically
  // A simple interval check until both are true is robust
  const readyCheckInterval = setInterval(() => {
     if (!openAIService) return;
     if (openAIService.openaiWs && openAIService.openaiWs.readyState === 1) {
         isOpenAiConnected = true;
         checkAndInitializeSession();
         clearInterval(readyCheckInterval);
     }
  }, 100);

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    if (callSid) {
       await markCallEnded(callSid);
    }
    if (openAIService && openAIService.openaiWs) {
      if (openAIService.openaiWs.readyState === 1) { // OPEN
        openAIService.openaiWs.close();
      }
    }
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
  });
};
