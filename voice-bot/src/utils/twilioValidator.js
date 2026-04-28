import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  try {
    const twilioSignature = request.headers['x-twilio-signature'];

    if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
        return; // Bypass in local dev
    }

    if (!twilioSignature) {
      logger.warn('Twilio signature missing');
      return reply.code(401).send('Unauthorized');
    }

    const url = `${config.server.publicUrl}${request.raw.url}`;
    const params = request.body || {};

    const isValid = twilio.validateRequest(
      config.twilio.authToken,
      twilioSignature,
      url,
      params
    );

    if (!isValid) {
      logger.warn('Invalid Twilio signature');
      return reply.code(401).send('Unauthorized');
    }
  } catch (error) {
    logger.error('Error validating Twilio request:', error);
    return reply.code(500).send('Internal Server Error');
  }
};
