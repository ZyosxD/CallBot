import express from 'express';
import { inboundCall, outboundTwiml, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Used by Twilio to fetch TwiML when an outbound call connects
// We might not validate this if it's internal/controlled by us, but Twilio will sign it.
// For now, let's validate it too.
router.post('/outbound-twiml', validateTwilioRequest, outboundTwiml);

// POST /voice/status-callback
// Used by Twilio to report call status
router.post('/status-callback', validateTwilioRequest, statusCallback);

export default router;
