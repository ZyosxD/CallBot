import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  const twilioSignature = request.headers['x-twilio-signature'];
  const params = request.body || {};

  const publicUrl = config.server.publicUrl;
  if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
    logger.info('Bypassing Twilio signature validation for local development.');
    return;
  }

  const url = `${publicUrl}${request.raw.url}`;

  if (!twilioSignature) {
    logger.warn('Twilio signature missing');
    return reply.code(403).send('Forbidden');
  }

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
