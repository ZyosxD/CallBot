import express from 'express';
import { inboundCall, outboundTwiML, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Returns TwiML for outbound calls initiated by Drip Service
router.post('/outbound-twiml', outboundTwiML);

// POST /voice/status-callback
// Handles call status updates (completed, failed, etc.)
router.post('/status-callback', statusCallback);

export default router;
