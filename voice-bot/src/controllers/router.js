import express from 'express';
import { inboundCall, outboundTwiml, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Used by Drip Service to initiate calls
router.post('/outbound-twiml', validateTwilioRequest, outboundTwiml);

// POST /voice/status-callback
// To handle call status updates and release locks
router.post('/status-callback', statusCallback); // We might want validation here too, but sometimes callback signatures are tricky.

export default router;
