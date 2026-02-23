import express from 'express';
import { inboundCall } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { setCallActive } from '../services/dripService.js';
import logger from '../utils/logger.js';

const router = express.Router();

// POST /voice/inbound
// Validates Twilio signature and returns TwiML to connect to WebSocket
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/status-callback
router.post('/status-callback', validateTwilioRequest, (req, res) => {
    const callStatus = req.body.CallStatus;
    logger.info(`Call Status Update: ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        setCallActive(false);
    }

    res.sendStatus(200);
});

export default router;
