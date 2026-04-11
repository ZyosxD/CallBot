import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (req, reply) => {
  // Skip validation in local development if public URL is not set, or is localhost/ngrok
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    return; // Fastify preHandlers resolve to proceed
  }

  const twilioSignature = req.headers['x-twilio-signature'];
  const url = config.server.publicUrl + req.raw.url;
  const params = req.body || {};

  const requestIsValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!requestIsValid) {
    logger.warn('Invalid Twilio Signature');
    return reply.code(403).send('Forbidden');
  }
};
