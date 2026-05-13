import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  // Skip validation in local development if public URL is not set or localhost
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    return;
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  const url = config.server.publicUrl + request.raw.url;
  const params = request.body || {};

  try {
    const requestIsValid = twilio.validateRequest(
      config.twilio.authToken,
      twilioSignature,
      url,
      params
    );

    if (!requestIsValid) {
      logger.warn(`Invalid Twilio Signature for URL: ${url}`);
      return reply.code(403).send('Forbidden');
    }
  } catch (error) {
    logger.error('Error validating Twilio signature:', error);
    return reply.code(403).send('Forbidden');
  }
};
