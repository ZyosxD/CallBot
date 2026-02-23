import express from 'express';
import { inboundCall, outboundTwiML, callStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
// For inbound calls
router.post('/inbound', validateTwilioRequest, inboundCall);

// GET/POST /voice/outbound-twiml
// Returns TwiML for outbound calls initiated by Drip Service
router.all('/outbound-twiml', outboundTwiML);

// POST /voice/status-callback
// Handles call status updates (completed, busy, etc.)
router.post('/status-callback', callStatusCallback);

export default router;
