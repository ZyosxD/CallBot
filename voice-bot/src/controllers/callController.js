import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
    try {
        logger.info('Incoming call received');
        const response = new VoiceResponse();

        // Mode is explicitly inbound for calls received on this endpoint
        const mode = 'inbound';
        // Use the caller's number, fallback to unknown
        const callerId = request.body?.From || 'unknown';

        const connect = response.connect();
        const stream = connect.stream({
            url: `wss://${request.headers.host}/voice/stream`,
        });

        stream.parameter({ name: 'mode', value: mode });
        stream.parameter({ name: 'callerId', value: callerId });

        reply.type('text/xml').send(response.toString());
    } catch (error) {
        logger.error('Error handling inbound call:', error);
        reply.status(500).send('Internal Server Error');
    }
};

export const inboundStatus = async (request, reply) => {
    try {
        const { CallStatus, CallSid } = request.body;
        logger.info(`Call Status Update for ${CallSid}: ${CallStatus}`);

        // Terminal states that release the lock
        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
            await markCallEnded(CallSid);
        }

        reply.send('OK');
    } catch (error) {
         logger.error('Error handling inbound status:', error);
         reply.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (ws, request) => {
    logger.info('New WebSocket connection');

    let callSid = 'unknown';
    let mode = 'inbound';
    let callerId = 'unknown';

    // The stream parameter custom args are sent during the 'start' event
    // so we must pass them in the start event handling.
    const openAIService = new OpenAIRealtimeService(ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.event === 'start') {
                callSid = data.start.callSid;
                mode = data.start.customParameters?.mode || 'inbound';
                callerId = data.start.customParameters?.callerId || 'unknown';

                openAIService.callSid = callSid;
                openAIService.mode = mode;
                openAIService.callerId = callerId;

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

        // Dynamically import markCallEnded to avoid circular dependencies and forcefully release lock
        if (callSid !== 'unknown') {
            const { markCallEnded } = await import('../services/dripService.js');
            await markCallEnded(callSid);
        }
    });
};