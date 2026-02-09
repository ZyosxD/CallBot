import express from 'express';
import { inboundCall, outboundCallTwiML, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket (Inbound Call)
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Returns TwiML for Outbound Calls initiated by Drip Service
router.post('/outbound-twiml', validateTwilioRequest, outboundCallTwiML);

// POST /voice/status-callback
// Handles Twilio status callbacks (busy, no-answer, completed, etc.)
router.post('/status-callback', validateTwilioRequest, handleStatusCallback);

export default router;
