import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  const twilioSignature = request.headers['x-twilio-signature'];

  if (!twilioSignature) {
    logger.warn('Missing X-Twilio-Signature header');
    return reply.status(403).send('Forbidden: Missing signature');
  }

  // Fastify raw url might not be exactly what Twilio signed, but usually is path + query
  const url = `${config.server.publicUrl}${request.raw.url}`;
  const params = request.body || {};

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    logger.warn(`Invalid Twilio signature for URL: ${url}`);
    return reply.status(403).send('Forbidden: Invalid signature');
  }
};
