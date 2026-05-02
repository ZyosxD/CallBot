import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  const publicUrl = config.server.publicUrl;

  // Bypass validation in local development
  if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
    logger.info('Bypassing Twilio validation for local development');
    return;
  }

  const twilioSignature = request.headers['x-twilio-signature'];

  if (!twilioSignature) {
    logger.warn('Missing Twilio signature');
    return reply.code(403).send('Forbidden');
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
    logger.warn('Invalid Twilio signature');
    return reply.code(403).send('Forbidden');
  }
};
