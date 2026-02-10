import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  // Skip validation in local development if public URL is not set or localhost
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost')) {
    return;
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  // Ensure the URL matches exactly what Twilio requested (https + host + path + query)
  // config.server.publicUrl should be the base URL (e.g. https://myapp.com) without trailing slash
  const url = config.server.publicUrl + request.url;
  const params = request.body || {};

  const requestIsValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!requestIsValid) {
    logger.warn(`Invalid Twilio Signature. URL: ${url}`);
    reply.code(403).send('Forbidden');
  }
};
