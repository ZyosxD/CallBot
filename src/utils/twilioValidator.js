import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (req, reply) => {
  // Skip validation in local development if public URL is not set or localhost
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost')) {
    return;
  }

  const twilioSignature = req.headers['x-twilio-signature'];
  // Fastify req.url includes query string. Twilio validation expects the full URL including query params if present.
  const url = config.server.publicUrl + req.url;
  const params = req.body || {};

  const requestIsValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!requestIsValid) {
    logger.warn('Invalid Twilio Signature');
    reply.status(403).send('Forbidden');
    // Returning reply object signals to Fastify that we handled the response
    return reply;
  }
};
