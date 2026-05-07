import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (request, reply, done) => {
  // Bypass validation if publicUrl is not set, or is localhost/ngrok
  const publicUrl = config.server.publicUrl;
  if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
    logger.info('Bypassing Twilio signature validation for local development.');
    return done();
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  if (!twilioSignature) {
    logger.warn('Missing Twilio signature.');
    return reply.code(403).send('Forbidden: Missing signature');
  }

  // Construct the full URL as Twilio would have used
  const url = `${publicUrl}${request.raw.url}`;

  // body is already parsed by @fastify/formbody
  const params = request.body || {};

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    logger.error('Invalid Twilio signature.');
    return reply.code(403).send('Forbidden: Invalid signature');
  }

  done();
};
