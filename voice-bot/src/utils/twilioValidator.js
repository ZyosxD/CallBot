import crypto from 'crypto';
import { config } from '../config/config.js';
import twilio from 'twilio';

export const validateTwilioRequest = async (request, reply) => {
    // Bypass validation in local dev if no public URL or if it's localhost/ngrok
    const publicUrl = config.server.publicUrl;
    if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
        return;
    }

    const twilioSignature = request.headers['x-twilio-signature'];

    // Construct the absolute URL
    // Use request.raw.url which contains the path AND query parameters
    const url = new URL(request.raw.url, publicUrl).href;

    const params = request.body || {};

    const isValid = twilio.validateRequest(
        config.twilio.authToken,
        twilioSignature,
        url,
        params
    );

    if (!isValid) {
        return reply.code(403).send('Forbidden: Invalid Twilio Signature');
    }
};