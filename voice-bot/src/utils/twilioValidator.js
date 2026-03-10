import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  const twilioSignature = request.headers['x-twilio-signature'];

  if (!twilioSignature) {
    logger.warn('Missing Twilio signature');
    return reply.status(403).send('Forbidden: Missing Twilio signature');
  }

  const protocol = request.headers['x-forwarded-proto'] || 'http';
  // Fastify request.raw.url gives the path + query string.
  // We need the full exact URL that Twilio used.
  const host = request.headers.host;

  // Try to use publicUrl config first, fallback to constructing it
  let publicUrl = config.server.publicUrl;
  let url = '';

  if (publicUrl) {
      // Remove trailing slash if exists
      publicUrl = publicUrl.replace(/\/$/, "");
      url = `${publicUrl}${request.raw.url}`;
  } else {
      url = `${protocol}://${host}${request.raw.url}`;
  }

  const params = request.body || {};

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    logger.warn(`Invalid Twilio signature for URL: ${url}`);
    return reply.status(403).send('Forbidden: Invalid Twilio signature');
  }
};
