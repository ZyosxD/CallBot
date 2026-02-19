import express from 'express';
import { inboundCall, outboundTwiml, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Returns TwiML for outbound calls initiated by Drip Service
router.post('/outbound-twiml', validateTwilioRequest, outboundTwiml);

// POST /voice/status-callback
// Handles call status updates (e.g., completed, busy, no-answer)
router.post('/status-callback', validateTwilioRequest, statusCallback);

export default router;
