import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
    try {
        // Skip validation locally or if PUBLIC_URL is missing
        if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
            return;
        }

        const twilioSignature = request.headers['x-twilio-signature'];
        if (!twilioSignature) {
            reply.code(403).send('Forbidden: No signature provided');
            return reply;
        }

        const url = `${config.server.publicUrl}${request.raw.url}`;
        const params = request.body || {};

        const isValid = twilio.validateRequest(
            config.twilio.authToken,
            twilioSignature,
            url,
            params
        );

        if (!isValid) {
            logger.warn('Failed Twilio Request Validation', { url, signature: twilioSignature });
            reply.code(403).send('Forbidden: Invalid Twilio Signature');
            return reply;
        }
    } catch (error) {
        logger.error('Error during Twilio request validation', error);
        reply.code(500).send('Internal Server Error');
        return reply;
    }
};
