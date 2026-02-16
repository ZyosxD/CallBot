import express from 'express';
import { inboundCall, outboundTwiml, handleCallStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Returns TwiML for outbound calls initiated by Drip Service
router.post('/outbound-twiml', validateTwilioRequest, outboundTwiml);

// POST /voice/status
// Webhook for Twilio call status updates
router.post('/status', validateTwilioRequest, handleCallStatus);

export default router;
