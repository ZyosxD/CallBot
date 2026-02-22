import express from 'express';
import { inboundCall, outboundTwiml, callStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Used by Drip Service to initiate outbound calls
router.post('/outbound-twiml', validateTwilioRequest, outboundTwiml);

// POST /voice/status-callback
// Twilio calls this when call status changes
router.post('/status-callback', validateTwilioRequest, callStatus);

export default router;
