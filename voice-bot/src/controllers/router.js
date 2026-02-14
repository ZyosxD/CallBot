import express from 'express';
import { inboundCall, outboundCall, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Used by Drip Service to generate TwiML for outbound calls
// No strict validation here for internal calls, or validate if needed (but it comes from Twilio callback)
router.post('/outbound-twiml', validateTwilioRequest, outboundCall);

// POST /voice/status-callback
// Updates call status (releases Drip lock)
router.post('/status-callback', handleStatusCallback);

export default router;
