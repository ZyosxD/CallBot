import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export async function validateTwilioRequest(request, reply) {
    const twilioSignature = request.headers['x-twilio-signature'];

    // Bypass validation for local development if publicUrl includes localhost or ngrok
    const publicUrl = config.server.publicUrl || '';
    if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
        return;
    }

    if (!twilioSignature) {
        logger.warn('Missing Twilio signature');
        return reply.code(403).send('Forbidden: Missing Twilio signature');
    }

    const url = `${publicUrl}${request.raw.url}`;
    const params = request.body || {};

    const isValid = twilio.validateRequest(
        config.twilio.authToken,
        twilioSignature,
        url,
        params
    );

    if (!isValid) {
        logger.warn(`Invalid Twilio signature for url: ${url}`);
        return reply.code(403).send('Forbidden: Invalid Twilio signature');
    }
}
