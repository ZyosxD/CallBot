import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from './logger.js';

export default async function validateTwilioRequest(request, reply) {
  // Bypass validation if running locally without a valid public URL
  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') || config.server.publicUrl.includes('ngrok')) {
    return;
  }

  const twilioSignature = request.headers['x-twilio-signature'];

  if (!twilioSignature) {
    logger.warn('Missing Twilio signature');
    return reply.code(403).send('Forbidden: Missing signature');
  }

  const url = `https://${request.headers.host}${request.raw.url}`;

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    request.body || {}
  );

  if (!isValid) {
    logger.warn(`Invalid Twilio signature for url: ${url}`);
    return reply.code(403).send('Forbidden: Invalid signature');
  }
}
