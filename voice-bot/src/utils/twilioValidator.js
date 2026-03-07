import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  // Skip validation in local development if public URL is not set or localhost
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost')) {
    return; // Fastify preHandler moves on to the next hook/handler if it returns normally
  }

  const twilioSignature = request.headers['x-twilio-signature'];
  const url = config.server.publicUrl + request.raw.url; // Use request.raw.url for Fastify

  // Twilio uses POST body parameters or query parameters
  const params = request.method === 'POST' ? request.body : request.query;

  try {
    const requestIsValid = twilio.validateRequest(
      config.twilio.authToken,
      twilioSignature,
      url,
      params
    );

    if (!requestIsValid) {
      logger.warn('Invalid Twilio Signature');
      reply.status(403).send('Forbidden');
      return reply; // Fastify stops request processing when reply is sent
    }
  } catch (error) {
    logger.error('Error validating Twilio request:', error);
    reply.status(500).send('Internal Server Error');
    return reply;
  }
};
