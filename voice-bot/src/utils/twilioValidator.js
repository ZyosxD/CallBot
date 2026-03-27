import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (request, reply, done) => {
  // Bypass validation in local development
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    return done();
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  // For Fastify, request.raw.url contains the original URL path + query string
  const url = `${config.server.publicUrl}${request.raw.url}`;
  const params = request.body || {};

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (isValid) {
    done();
  } else {
    logger.warn('Invalid Twilio Request Signature');
    reply.status(403).send('Forbidden');
  }
};
