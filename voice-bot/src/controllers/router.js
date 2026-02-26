import express from 'express';
import { inboundCall, outboundCall, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// Inbound Call webhook
router.post('/inbound', validateTwilioRequest, inboundCall);

// Outbound Call TwiML webhook
// This is called by Twilio when we initiate an outbound call via API
// We don't necessarily validate request here if it's internal logic initiating it,
// but Twilio will sign it if we configure it correctly. For now, let's skip strict validation or apply it if we can.
// Since it's our own server initiating the call, we can trust the source if we want, but validating Twilio signature is safer.
router.post('/outbound-twiml', validateTwilioRequest, outboundCall);

// Status Callback webhook
router.post('/status-callback', handleStatusCallback);

export default router;
