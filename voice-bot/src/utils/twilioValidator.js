import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost')) {
    return;
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  const url = config.server.publicUrl + request.raw.url;
  const params = request.body;

  const requestIsValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!requestIsValid) {
    logger.warn('Invalid Twilio Signature');
    reply.code(403).send('Forbidden');
  }
};
