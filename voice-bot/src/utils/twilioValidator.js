import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  const twilioSignature = request.headers['x-twilio-signature'];

  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    logger.info('Bypassing Twilio validation for local development');
    return;
  }

  if (!twilioSignature) {
    reply.code(401).send('No Twilio signature provided');
    throw new Error('Unauthorized');
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
    logger.warn('Invalid Twilio signature', { url, params, signature: twilioSignature });
    reply.code(403).send('Invalid Twilio signature');
    throw new Error('Forbidden');
  }
};
