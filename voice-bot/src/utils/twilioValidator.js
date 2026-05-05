import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    return; // Bypass validation in local dev
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  const params = request.body || {};
  const url = `${config.server.publicUrl}${request.raw.url}`;

  if (!twilioSignature) {
    logger.warn('Missing X-Twilio-Signature header');
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
