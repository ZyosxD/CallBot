import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
    try {
        const publicUrl = config.server.publicUrl;

        // Bypass validation if publicUrl is not set or if running locally with localhost/ngrok
        if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
            return;
        }

        const twilioSignature = request.headers['x-twilio-signature'];
        if (!twilioSignature) {
            logger.warn('Twilio signature missing');
            return reply.code(403).send('Forbidden: Twilio signature missing');
        }

        // Full URL is required for validation
        const url = `${publicUrl}${request.raw.url}`;
        const params = request.body || {};

        const isValid = twilio.validateRequest(
            config.twilio.authToken,
            twilioSignature,
            url,
            params
        );

        if (!isValid) {
            logger.warn('Invalid Twilio signature');
            return reply.code(403).send('Forbidden: Invalid Twilio signature');
        }
    } catch (error) {
        logger.error('Error validating Twilio request:', error);
        return reply.code(500).send('Internal Server Error validating request');
    }
};
