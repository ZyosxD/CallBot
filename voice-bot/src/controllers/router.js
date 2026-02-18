import express from 'express';
import { inboundCall, outboundTwiML, statusCallback } from './callController.js';

const router = express.Router();

router.post('/inbound', inboundCall);
router.post('/outbound-twiml', outboundTwiML);
router.post('/status-callback', statusCallback);

export default router;
