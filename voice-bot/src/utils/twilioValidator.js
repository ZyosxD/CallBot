import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  // Always allow stream websocket connection, it doesn't have signature
  if (request.routerPath === '/voice/stream') {
    return;
  }

  // Skip validation in development if no auth token
  if (!config.twilio.authToken) {
    logger.warn('Skipping Twilio validation: No auth token set');
    return;
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  if (!twilioSignature) {
    logger.warn('Missing Twilio signature');
    return reply.status(403).send('Forbidden');
  }

  // Construct the URL exactly as Twilio requested it
  const url = `${config.server.publicUrl}${request.raw.url}`;
  const params = request.body || {};

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    logger.warn(`Invalid Twilio signature. URL: ${url}`);
    return reply.status(403).send('Forbidden');
  }
};
