import express from 'express';
import { inboundCall, callStatusUpdate } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/status-callback
router.post('/status-callback', validateTwilioRequest, callStatusUpdate);

export default router;
