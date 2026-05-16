import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  try {
    // Bypass validation in local dev if no public URL or using localhost/ngrok
    if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
      return;
    }

    const twilioSignature = request.headers['x-twilio-signature'];

    // Construct the full URL for validation
    const url = `https://${request.headers.host}${request.raw.url}`;

    const params = request.body || {};

    const isValid = twilio.validateRequest(
      config.twilio.authToken,
      twilioSignature,
      url,
      params
    );

    if (!isValid) {
      logger.warn(`Invalid Twilio signature for request to ${url}`);
      return reply.code(403).send('Forbidden');
    }
  } catch (error) {
    logger.error('Error validating Twilio request:', error);
    return reply.code(500).send('Internal Server Error');
  }
};
