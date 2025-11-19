import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (req, res, next) => {
  // Skip validation in local development if public URL is not set or localhost
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost')) {
    return next();
  }

  const twilioSignature = req.headers['x-twilio-signature'];
  const url = config.server.publicUrl + req.originalUrl;
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
    res.status(403).send('Forbidden');
  }
};
