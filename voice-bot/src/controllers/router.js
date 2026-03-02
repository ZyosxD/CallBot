import express from 'express';
import { inboundCall, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

router.post('/inbound', validateTwilioRequest, inboundCall);
router.post('/status-callback', validateTwilioRequest, statusCallback);

export default router;
