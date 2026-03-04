import express from 'express';
import { inboundCall, handleStatusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';
import { handleOutboundTwiML } from '../services/dripService.js';

const router = express.Router();

router.post('/inbound', validateTwilioRequest, inboundCall);
router.post('/status-callback', validateTwilioRequest, handleStatusCallback);
router.post('/outbound', validateTwilioRequest, handleOutboundTwiML);

export default router;
