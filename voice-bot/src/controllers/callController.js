import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';
    logger.info(`Incoming call received from ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = (request, reply) => {
  try {
    const callStatus = request.body.CallStatus;
    const callSid = request.body.CallSid;

    logger.info(`CallStatus update: ${callSid} is ${callStatus}`);

    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'canceled') {
      markCallEnded(callSid);
    }

    return reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error in statusCallback:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let mode = 'inbound';
  let callerId = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract parameters from Twilio Media Stream Start Event
        const customParams = data.start.customParameters || {};
        if (customParams.callerId) openAIService.callerId = customParams.callerId;
        if (customParams.mode) openAIService.mode = customParams.mode;

        logger.info(`Stream started: SID=${callSid}, Mode=${openAIService.mode}, Caller=${openAIService.callerId}`);

        // Now that we have the parameters, we can send the session update
        openAIService.sendSessionUpdate();
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
