import { inboundCall, handleWebSocket, handleCallStatus } from '../controllers/callController.js';

async function voiceRoutes(fastify, options) {
  // Inbound call route (POST /voice/inbound)
  fastify.post('/voice/inbound', inboundCall);

  // Call status callback
  fastify.post('/voice/status', handleCallStatus);

  // WebSocket route (GET /voice/stream)
  fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
}

export default voiceRoutes;
