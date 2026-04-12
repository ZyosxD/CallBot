import { handleInboundCall, handleOutboundCall, handleWebSocket, inboundStatus } from './callController.js';

export default async function router(fastify, options) {
  fastify.post('/inbound', handleInboundCall);
  fastify.post('/outbound', handleOutboundCall);
  fastify.post('/inbound/status', inboundStatus);
  fastify.get('/stream', { websocket: true }, handleWebSocket);
}
