import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  // Skip validation in local development if public URL is not set, or includes localhost/ngrok
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    return; // Fastify preHandlers just return to continue
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  const url = config.server.publicUrl + request.raw.url;
  const params = request.body || {};

  const requestIsValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!requestIsValid) {
    logger.warn('Invalid Twilio Signature');
    return reply.code(403).send('Forbidden'); // Fastify preHandlers must send reply and return to stop execution
  }
};
