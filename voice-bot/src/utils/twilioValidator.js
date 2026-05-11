import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
    try {
        const twilioSignature = request.headers['x-twilio-signature'];

        // Skip validation locally
        if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
            return;
        }

        if (!twilioSignature) {
            logger.warn('Missing Twilio signature');
            return reply.code(403).send('Forbidden: Missing signature');
        }

        const fullUrl = `${config.server.publicUrl}${request.raw.url}`;

        const isValid = twilio.validateRequest(
            config.twilio.authToken,
            twilioSignature,
            fullUrl,
            request.body || {}
        );

        if (!isValid) {
            logger.warn('Invalid Twilio signature');
            return reply.code(403).send('Forbidden: Invalid signature');
        }
    } catch (error) {
        logger.error('Error validating Twilio request:', error);
        return reply.code(500).send('Internal Server Error');
    }
};
