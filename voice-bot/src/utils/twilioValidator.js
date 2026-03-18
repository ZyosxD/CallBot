import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (req, reply, done) => {
  // Bypass validation in local development environments
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    logger.info('Bypassing Twilio signature check for local environment');
    done();
    return;
  }

  const twilioSignature = req.headers['x-twilio-signature'];
  const params = req.body || {};

  // Need the exact full requested URL for validation to work correctly
  const url = config.server.publicUrl + req.raw.url;

  if (!twilioSignature) {
    logger.warn('Twilio signature missing from request');
    reply.status(403).send('Forbidden: No signature provided');
    return;
  }

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    logger.warn('Invalid Twilio signature');
    reply.status(403).send('Forbidden: Invalid signature');
    return;
  }

  done();
};
