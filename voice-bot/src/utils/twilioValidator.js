import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  // Bypass validation for local dev if publicUrl is not set or contains localhost/ngrok
  const publicUrl = config.server.publicUrl;
  if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
    return;
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  if (!twilioSignature) {
    logger.error('Missing Twilio signature');
    return reply.code(403).send('Forbidden');
  }

  const fullUrl = `${publicUrl}${request.raw.url}`;

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    fullUrl,
    request.body || {}
  );

  if (!isValid) {
    logger.error('Invalid Twilio signature');
    return reply.code(403).send('Forbidden');
  }
};
