import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = (request, reply, done) => {
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    return done();
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  const url = config.server.publicUrl + request.raw.url;
  const params = request.body;

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
    return reply.code(403).send('Forbidden');
  }
};
