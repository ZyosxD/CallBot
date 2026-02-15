import express from 'express';
import { inboundCall, outboundTwiml, callStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Used by Drip Service to get TwiML for initiated calls
router.post('/outbound-twiml', validateTwilioRequest, outboundTwiml);

// POST /voice/status
// Webhook for call status updates (used for concurrency control)
router.post('/status', validateTwilioRequest, callStatus);

export default router;
