import express from 'express';
import { inboundCall, outboundCallTwiml, callStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Returns TwiML for outbound calls initiated by Drip Service
router.post('/outbound-twiml', outboundCallTwiml); // Add validation if needed

// POST /voice/status-callback
// Handles call status updates (completed, busy, etc.)
router.post('/status-callback', callStatusCallback);

export default router;
