import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (request, reply, done) => {
  // Skip validation in local development if public URL is not set or localhost
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost')) {
    return done();
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  // Fastify request.raw.url contains the original URL including query parameters
  const url = config.server.publicUrl + request.raw.url;
  const params = request.body || {};

  try {
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
  } catch (err) {
    logger.error('Error validating Twilio signature', err);
    reply.status(500).send('Internal Server Error');
  }
};
