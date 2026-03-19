import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
    try {
        const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';
        logger.info(`Incoming call received from: ${callerId}`);

        const response = new VoiceResponse();
        const connect = response.connect();
        const stream = connect.stream({
            url: `wss://${request.headers.host}/voice/stream`,
        });

        // Pass inbound mode and callerId to WebSocket
        stream.parameter({ name: 'mode', value: 'inbound' });
        stream.parameter({ name: 'callerId', value: callerId });

        reply.type('text/xml');
        reply.send(response.toString());
    } catch (error) {
        logger.error('Error handling inbound call:', error);
        reply.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (ws, req) => {
    logger.info('New WebSocket connection for Voice Stream');

    let callSid = 'unknown';
    let callerId = 'unknown';
    let mode = 'inbound';
    let openAIService = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.event === 'start') {
                callSid = data.start.callSid;

                // Extract custom parameters sent via TwiML
                if (data.start.customParameters) {
                    callerId = data.start.customParameters.callerId || 'unknown';
                    mode = data.start.customParameters.mode || 'inbound';
                }

                logger.info(`Stream started: ${data.start.streamSid} | CallSid: ${callSid} | Mode: ${mode} | CallerId: ${callerId}`);

                openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
                openAIService.connect();
                openAIService.handleTwilioMedia(data);

            } else if (data.event === 'media') {
                if (openAIService) openAIService.handleTwilioMedia(data);
            } else if (data.event === 'stop') {
                logger.info(`Stream stopped for call ${callSid}`);
                if (openAIService && openAIService.openaiWs) {
                    openAIService.openaiWs.close();
                }
                ws.close();
            }
        } catch (error) {
            logger.error('Error processing WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        logger.info(`WebSocket connection closed for call ${callSid}`);
        if (openAIService && openAIService.openaiWs) {
            openAIService.openaiWs.close();
        }
    });
};

export const statusCallback = (request, reply) => {
    try {
        const { CallSid, CallStatus } = request.body || {};
        logger.info(`Call ${CallSid} status changed to ${CallStatus}`);

        if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
            markCallEnded(CallSid);
        }

        reply.status(200).send('OK');
    } catch (error) {
        logger.error(`Error in status callback: ${error}`);
        reply.status(500).send('Error processing status callback');
    }
};
