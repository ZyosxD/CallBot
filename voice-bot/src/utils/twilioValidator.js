import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  const twilioSignature = request.headers['x-twilio-signature'];
  const params = request.body || {};

  // Bypass validation in local dev if no public URL or using localhost/ngrok
  const publicUrl = config.server.publicUrl;
  if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
    logger.info('Skipping Twilio validation for local development');
    return;
  }

  // Construct the full URL being requested
  // Natively using fastify's request object and request.raw.url
  const url = `${publicUrl}${request.raw.url}`;

  try {
    const isValid = twilio.validateRequest(
      config.twilio.authToken,
      twilioSignature,
      url,
      params
    );

    if (!isValid) {
      logger.warn('Twilio Request Validation Failed');
      return reply.code(403).send('Forbidden');
    }
  } catch (error) {
    logger.error('Error validating Twilio request:', error);
    return reply.code(500).send('Internal Server Error');
  }
};
