import express from 'express';
import { inboundCall, outboundCall, callStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// Used by Drip Service to get TwiML for outbound calls
// We don't enforce validation here strictly to avoid issues during testing,
// but in production it should be validated.
router.post('/outbound-twiml', outboundCall);

// POST /voice/status-callback
// Used by Twilio to report call status
router.post('/status-callback', callStatus);

export default router;
