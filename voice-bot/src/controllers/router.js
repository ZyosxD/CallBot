import express from 'express';
import { inboundCall, outboundCall } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound
// Returns TwiML for outbound call to connect to WebSocket
router.post('/outbound', validateTwilioRequest, outboundCall);

export default router;
