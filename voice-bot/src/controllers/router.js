import express from 'express';
import { inboundCall, outboundTwiml, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Generates TwiML for outbound calls
router.post('/outbound-twiml', validateTwilioRequest, outboundTwiml);

// POST /voice/status-callback
// Handles call status updates
router.post('/status-callback', validateTwilioRequest, handleStatusCallback);

export default router;
