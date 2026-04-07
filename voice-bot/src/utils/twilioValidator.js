import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export const validateTwilioRequest = async (request, reply) => {
  const twilioSignature = request.headers['x-twilio-signature'];
  const params = request.body || {};

  // Bypass validation in local/ngrok envs if configured
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
      logger.info('Bypassing Twilio validation for local environment.');
      return;
  }

  // Determine full URL
  const protocol = request.headers['x-forwarded-proto'] || request.protocol;
  const host = request.headers.host;
  const url = `${protocol}://${host}${request.raw.url}`;

  const isValid = twilio.validateRequest(
      config.twilio.authToken,
      twilioSignature,
      url,
      params
  );

  if (!isValid) {
      logger.error('Twilio Request Validation Failed');
      return reply.code(403).send('Forbidden');
  }
};
