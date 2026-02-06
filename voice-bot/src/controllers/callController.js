import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import logger from '../utils/logger.js';
import { notifyCallEnded } from '../services/dripService.js';

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
    // Notify Drip Service that call ended
    notifyCallEnded();
  });
};
