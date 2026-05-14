import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  const twilioSignature = request.headers['x-twilio-signature'];
  const publicUrl = config.server.publicUrl;

  if (!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('ngrok')) {
    logger.info('Bypassing Twilio signature validation for local/ngrok development');
    return; // Fastify continues
  }

  const url = `${publicUrl}${request.raw.url}`;
  const params = request.body || {};

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    logger.warn(`Invalid Twilio signature for url: ${url}`);
    return reply.code(403).send('Forbidden: Invalid Twilio Signature');
  }
};
