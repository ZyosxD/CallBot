import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (req, reply, next) => {
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    return next();
  }

  const twilioSignature = req.headers['x-twilio-signature'];
  // In Fastify, req.raw.url contains the original URL including query strings
  const url = config.server.publicUrl + req.raw.url;
  const params = req.body;

  const requestIsValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (requestIsValid) {
    next();
  } else {
    logger.warn('Invalid Twilio Signature');
    return reply.code(403).send('Forbidden');
  }
};