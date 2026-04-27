import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  // Bypass validation in local dev if configured
  if (
    !config.server.publicUrl ||
    config.server.publicUrl.includes('localhost') ||
    config.server.publicUrl.includes('ngrok')
  ) {
    logger.debug('Skipping Twilio validation for local development');
    return;
  }

  const twilioSignature = request.headers['x-twilio-signature'];

  if (!twilioSignature) {
    logger.error('No Twilio signature provided');
    return reply.code(400).send('No Twilio signature provided');
  }

  // Use request.raw.url combined with publicUrl for accurate signature matching
  let url = config.server.publicUrl + request.raw.url;

  const params = request.body || {};

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    logger.error('Invalid Twilio signature');
    return reply.code(403).send('Invalid Twilio signature');
  }
};
