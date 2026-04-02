import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (req, reply, done) => {
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    return done();
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

  if (requestIsValid) {
    done();
  } else {
    logger.warn('Invalid Twilio Signature');
    reply.status(403).send('Forbidden');
  }
};
