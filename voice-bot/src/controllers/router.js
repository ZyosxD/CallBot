import express from 'express';
import { inboundCall, outboundTwiml, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

// POST /voice/inbound
router.post('/inbound', validateTwilioRequest, inboundCall);

// POST /voice/outbound-twiml
router.post('/outbound-twiml', outboundTwiml);

// POST /voice/status-callback
router.post('/status-callback', handleStatusCallback);

export default router;
