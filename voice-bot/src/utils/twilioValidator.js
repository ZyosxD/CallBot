import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (req, reply, done) => {
  // Skip validation in local development if public URL is not set or localhost
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost')) {
    return done();
  }

  const twilioSignature = req.headers['x-twilio-signature'];
  // Fastify request natively exposes raw.url which contains the correct path and query parameters
  const url = config.server.publicUrl + req.raw.url;
  const params = req.body || {};

  const requestIsValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (requestIsValid) {
    done();
  } else {
    logger.warn('Invalid Twilio Signature');
    reply.status(403).send('Forbidden');
  }
};
