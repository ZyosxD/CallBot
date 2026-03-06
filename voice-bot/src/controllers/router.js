import { inboundCall, callStatusCallback, handleWebSocket } from './callController.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

export const validateTwilioRequest = (request, reply, done) => {
  const twilioSignature = request.headers['x-twilio-signature'];
  const url = config.server.publicUrl + request.url;
  const params = request.body || {};

  if (!twilioSignature) {
    logger.error('No Twilio signature found in request headers');
    return reply.status(403).send('Forbidden');
  }

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    logger.error('Invalid Twilio signature');
    return reply.status(403).send('Forbidden');
  }

  done();
};

export default function router(fastify, opts, done) {
  fastify.post('/voice/inbound', { preHandler: validateTwilioRequest }, inboundCall);
  fastify.post('/voice/status-callback', { preHandler: validateTwilioRequest }, callStatusCallback);

  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection.socket, req);
  });

  done();
}
