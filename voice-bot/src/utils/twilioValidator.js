import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  try {
    const twilioSignature = request.headers['x-twilio-signature'];

    // Bypass validation for local development or if not configured properly
    const publicUrl = config.server.publicUrl;
    if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
      logger.info('Bypassing Twilio signature validation for local/ngrok environment.');
      return;
    }

    if (!twilioSignature) {
      logger.warn('Missing X-Twilio-Signature header');
      return reply.code(403).send('Forbidden: Missing Twilio Signature');
    }

    // Fastify natively provides request.raw.url
    // request.raw.url gives the path (e.g., /voice/inbound)
    // we need to combine it with the configured base public url.
    // Make sure we don't end up with double slashes if publicUrl has a trailing slash
    const baseUrl = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
    const url = `${baseUrl}${request.raw.url}`;

    // request.body holds the parsed application/x-www-form-urlencoded params
    const params = request.body || {};

    const isValid = twilio.validateRequest(
      config.twilio.authToken,
      twilioSignature,
      url,
      params
    );

    if (!isValid) {
      logger.warn('Invalid Twilio signature');
      return reply.code(403).send('Forbidden: Invalid Twilio Signature');
    }
  } catch (error) {
    logger.error('Error validating Twilio request:', error);
    return reply.code(500).send('Internal Server Error during validation');
  }
};
