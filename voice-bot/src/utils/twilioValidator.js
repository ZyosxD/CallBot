import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (request, reply, done) => {
  // Bypass validation in dev/local mode
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    logger.info('Bypassing Twilio validation for local environment.');
    done();
    return;
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  const url = `${config.server.publicUrl}${request.url}`;

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
    logger.warn('Invalid Twilio signature detected.');
    return reply.status(403).send('Forbidden');
  }
};
