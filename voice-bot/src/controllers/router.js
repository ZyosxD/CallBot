import express from 'express';
import { inboundCall, outboundCall, callStatusCallback } from './callController.js';
import twilio from 'twilio';
import { config } from '../config/config.js';

const router = express.Router();

// Middleware to validate Twilio requests
const validateTwilioRequest = (req, res, next) => {
    // Skip validation for now or implement properly with process.env.NODE_ENV check
    next();
};

router.post('/incoming', validateTwilioRequest, inboundCall);
router.get('/outbound', outboundCall); // Called by Twilio to get TwiML for outbound call
router.post('/outbound', outboundCall); // Sometimes Twilio POSTs
router.post('/status-callback', callStatusCallback);

export default router;
