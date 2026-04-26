import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (request, reply, done) => {
  const twilioSignature = request.headers['x-twilio-signature'];

  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    logger.info('Skipping Twilio validation for local environment.');
    return done();
  }

  if (!twilioSignature) {
    logger.warn('Twilio signature missing in request.');
    return reply.code(403).send('Forbidden: Twilio signature missing');
  }

  const fullUrl = `${config.server.publicUrl}${request.raw.url}`;
  const params = request.body || {};

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    fullUrl,
    params
  );

  if (isValid) {
    done();
  } else {
    logger.warn('Invalid Twilio signature.');
    return reply.code(403).send('Forbidden: Invalid Twilio signature');
  }
};
