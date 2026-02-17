import express from 'express';
import { inboundCall, outboundTwiml } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import logger from '../utils/logger.js';
import { callEnded } from '../services/dripService.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
// This is called by Twilio when we initiate an outbound call.
// It returns TwiML instructions to connect to the WebSocket stream.
router.post('/outbound-twiml', validateTwilioRequest, outboundTwiml);

// POST /voice/status
// Webhook for call status updates (completed, busy, no-answer, etc.)
router.post('/status', (req, res) => {
    const { CallSid, CallStatus } = req.body;
    logger.info(`Call Status Update: ${CallSid} - ${CallStatus}`);

    // Handle status that ends the call lifecycle without successful connection
    // 'busy', 'no-answer', 'failed', 'canceled' mean the call never connected properly
    // so the WebSocket might not have opened or closed correctly.
    // We MUST release the lock here.
    if (['busy', 'no-answer', 'failed', 'canceled', 'completed'].includes(CallStatus)) {
        // We log it and release the lock.
        // callEnded() is idempotent (safe to call multiple times).
        callEnded();
    }

    res.sendStatus(200);
});

export default router;
