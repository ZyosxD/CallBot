import express from 'express';
import { inboundCall, handleCallStatus } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/status-callback
// Handles call status updates (completed, busy, etc.) to release drip lock
router.post('/status-callback', validateTwilioRequest, handleCallStatus);

export default router;
