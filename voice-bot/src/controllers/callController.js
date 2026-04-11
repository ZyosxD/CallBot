import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const host = req.headers.host;
    const callerId = req.body?.From || 'unknown';

    const stream = connect.stream({
      url: `wss://${host}/voice/stream`,
    });

    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });
    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (req, reply) => {
  try {
    const callSid = req.body?.CallSid;
    const status = req.body?.CallStatus;
    logger.info(`Call Status Update: ${callSid} is ${status}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
        // Dynamically import markCallEnded to avoid circular dependency
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    }

    return reply.status(200).send('OK');
  } catch(error) {
    logger.error('Error handling inbound status:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // Extract fastify websocket safely
  const ws = connection.socket ? connection.socket : connection;
  let callSid = 'unknown';

  // Dynamically import to instantiate OpenAIRealtimeService safely
  import('../services/openaiRealtime.js').then(({ OpenAIRealtimeService }) => {
    const openAIService = new OpenAIRealtimeService(ws, callSid);
    openAIService.connect();

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        if (data.event === 'start') {
          callSid = data.start.callSid;
          openAIService.callSid = callSid;

          // Extract parameters from Twilio
          const customParams = data.start.customParameters || {};
          openAIService.mode = customParams.mode || 'inbound';

          // Fallback logic for callerId depending on mode
          const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
          openAIService.callerId = customParams.callerId || urlParams.get('callerId') || 'unknown';

          openAIService.handleTwilioMedia(data);
        } else if (data.event === 'media') {
          openAIService.handleTwilioMedia(data);
        } else if (data.event === 'stop') {
          logger.info(`Stream stopped for call ${callSid}`);
          import('../services/dripService.js').then(({ markCallEnded }) => {
             markCallEnded(callSid);
          });
          ws.close();
        }
      } catch (error) {
        logger.error('Error processing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      logger.info('WebSocket connection closed');
      import('../services/dripService.js').then(({ markCallEnded }) => {
         markCallEnded(callSid);
      });
      if (openAIService.openaiWs) {
          openAIService.openaiWs.close();
      }
    });
  }).catch(err => {
     logger.error("Failed to load OpenAIRealtimeService: ", err);
  });
};
