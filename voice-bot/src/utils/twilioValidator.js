import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (req, reply) => {
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost')) {
    return;
  }

  const twilioSignature = req.headers['x-twilio-signature'];
  const url = config.server.publicUrl + req.raw.url;
  const params = req.body;

  const requestIsValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!requestIsValid) {
    logger.warn('Invalid Twilio Signature');
    reply.status(403).send('Forbidden');
    return reply;
  }
};
