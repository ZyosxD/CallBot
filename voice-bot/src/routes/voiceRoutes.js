import { handleWebSocket } from '../controllers/callController.js';
import twilio from 'twilio';

const VoiceResponse = twilio.twiml.VoiceResponse;

export default async function voiceRoutes(fastify, options) {

  // Inbound Call TwiML - When someone calls the bot
  fastify.post('/inbound', async (request, reply) => {
    const response = new VoiceResponse();
    const connect = response.connect();
    // Use the host from the request to construct the WSS URL
    const host = request.headers.host;
    connect.stream({
      url: `wss://${host}/voice/stream`,
    });

    reply.type('text/xml');
    return response.toString();
  });

  // Outbound Call TwiML - When the bot calls someone
  // This endpoint is fetched by Twilio when the call connects
  fastify.post('/outbound-twiml', async (request, reply) => {
      const response = new VoiceResponse();
      // Optional: Add a pause or greeting if needed, but Stream connects immediately usually
      const connect = response.connect();
      const host = request.headers.host;

      connect.stream({
        url: `wss://${host}/voice/stream`,
      });

      reply.type('text/xml');
      return response.toString();
  });

  // Support GET for debugging or if Twilio is configured for GET
  fastify.get('/outbound-twiml', async (request, reply) => {
      const response = new VoiceResponse();
      const connect = response.connect();
      const host = request.headers.host;
      connect.stream({
        url: `wss://${host}/voice/stream`,
      });
      reply.type('text/xml');
      return response.toString();
  });


  // WebSocket Route
  fastify.get('/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection.socket, req);
  });
}
