import express from 'express';
import { inboundCall, outboundCall } from './callController.js';
// import { validateTwilioRequest } from '../utils/twilioValidator.js';

const router = express.Router();

router.post('/inbound', inboundCall);
router.post('/outbound', outboundCall);

export default router;
