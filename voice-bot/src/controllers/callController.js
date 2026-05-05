import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';
import { config } from '../config/config.js';
import twilio from 'twilio';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  const callSid = request.body?.CallSid;
  const fromNumber = request.body?.From;
  const direction = request.body?.Direction;

  logger.info(`Received webhook for call ${callSid} from ${fromNumber}, Direction: ${direction}`);

  const isOutbound = direction === 'outbound-api';
  const callerId = isOutbound ? request.body?.To : fromNumber;
  const mode = isOutbound ? 'outbound' : 'inbound';

  const host = config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : request.headers.host;
  const protocol = config.server.publicUrl && config.server.publicUrl.startsWith('https') ? 'wss' : 'ws';

  const twiml = new VoiceResponse();
  const connect = twiml.connect();
  const stream = connect.stream({
      url: `${protocol}://${host}/voice/stream`
  });
  stream.parameter({ name: 'callerId', value: callerId });
  stream.parameter({ name: 'mode', value: mode });

  reply.type('text/xml').send(twiml.toString());
};

export const inboundStatus = async (request, reply) => {
  const callSid = request.body?.CallSid;
  const callStatus = request.body?.CallStatus;

  logger.info(`Status callback for call ${callSid}: ${callStatus}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      markCallEnded(callSid);
  }

  reply.send({ status: 'ok' });
};

export const handleWebSocket = (connection, req) => {
    // Fastify v11 exposes connection.socket
    const ws = connection.socket ? connection.socket : connection;

    let aiService = null;
    let currentCallSid = 'unknown';

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.event === 'start') {
                currentCallSid = data.start.callSid;
                const customParams = data.start.customParameters || {};
                const callerId = customParams.callerId || 'unknown';
                const mode = customParams.mode || 'inbound';

                logger.info(`WebSocket connection started for call ${currentCallSid}. Mode: ${mode}, CallerId: ${callerId}`);

                aiService = new OpenAIRealtimeService(ws, currentCallSid, callerId, mode);
                await aiService.connect();
                aiService.handleTwilioMedia(data);
            } else if (data.event === 'media' && aiService) {
                aiService.handleTwilioMedia(data);
            } else if (data.event === 'stop') {
                logger.info(`Twilio Stream stopped for ${currentCallSid}`);
                markCallEnded(currentCallSid);
            }
        } catch (error) {
            logger.error('Error handling WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        logger.info(`WebSocket connection closed for call ${currentCallSid}`);
        markCallEnded(currentCallSid);
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error for call ${currentCallSid}:`, error);
        markCallEnded(currentCallSid);
    });
};
