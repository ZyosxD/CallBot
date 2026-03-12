import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  const twilioSignature = request.headers['x-twilio-signature'];
  const authToken = config.twilio.authToken;
  const url = `${config.server.publicUrl}${request.raw.url}`;
  const params = request.body || {};

  if (!twilioSignature || !authToken) {
    logger.warn('Missing Twilio signature or auth token');
    return reply.status(403).send('Forbidden');
  }

  const isValid = twilio.validateRequest(authToken, twilioSignature, url, params);

  if (!isValid) {
    logger.warn(`Invalid Twilio signature for url: ${url}`);
    return reply.status(403).send('Forbidden: Invalid Twilio Signature');
  }
};
