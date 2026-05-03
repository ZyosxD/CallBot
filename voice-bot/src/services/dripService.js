import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

import logger from '../utils/logger.js';
import { config } from '../config/config.js';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_PATH = path.join(__dirname, '..', 'data', 'clients.json');

// Drip state
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;
let twilioClient = null;

// Ensure twilio client is created correctly
const getTwilioClient = () => {
    if (!twilioClient && config.twilio.accountSid && config.twilio.authToken) {
        twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    }
    return twilioClient;
};

// Polling interval 10s
const POLLING_INTERVAL_MS = 10000;

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');

    // Create dayjs objects for start/end times in Denver time
    const morningStart = now.hour(9).minute(30).second(0);
    const morningEnd = now.hour(11).minute(30).second(0);

    const afternoonStart = now.hour(14).minute(30).second(0);
    const afternoonEnd = now.hour(15).minute(30).second(0);

    const isMorning = now.isBetween(morningStart, morningEnd, 'minute', '[]');
    const isAfternoon = now.isBetween(afternoonStart, afternoonEnd, 'minute', '[]');

    return isMorning || isAfternoon;
};

const tick = async () => {
    try {
        if (!isWithinOperatingHours()) {
            logger.info('Outside operating hours. Waiting...');
            return; // Wait for next tick, do not stop drip entirely
        }

        if (isCallActive) {
            logger.info(`Call in progress (Sid: ${activeCallSid}). Waiting...`);
            return;
        }

        let clients = [];
        try {
            if (fs.existsSync(CLIENTS_PATH)) {
                clients = JSON.parse(fs.readFileSync(CLIENTS_PATH, 'utf8'));
            }
        } catch (e) {
            logger.error('Error reading clients.json:', e);
            return;
        }

        const pendingIndex = clients.findIndex(c => c.status === 'PENDING');

        if (pendingIndex === -1) {
            logger.info('No PENDING clients left. Waiting...');
            return;
        }

        const clientToCall = clients[pendingIndex];
        const clientPhone = clientToCall.phone;

        if (!clientPhone) {
             logger.warn('Client found without a phone number. Skipping...');
             clients[pendingIndex].status = 'FAILED_NO_PHONE';
             fs.writeFileSync(CLIENTS_PATH, JSON.stringify(clients, null, 2));
             return;
        }

        logger.info(`Initiating outbound call to ${clientPhone}...`);

        const client = getTwilioClient();
        if (!client) {
             logger.error('Twilio client not initialized (missing credentials).');
             return;
        }

        isCallActive = true;

        // Pass the clientPhone as the callerId to the TwiML stream using url parameters
        const encodedCallerId = encodeURIComponent(clientPhone);

        const call = await client.calls.create({
            to: clientPhone,
            from: config.twilio.phoneNumber,
            twiml: `
                <Response>
                    <Connect>
                        <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
                            <Parameter name="callerId" value="${encodedCallerId}" />
                            <Parameter name="mode" value="outbound" />
                        </Stream>
                    </Connect>
                </Response>
            `,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
            // Empty array means receive all terminal status callbacks
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'failed', 'no-answer', 'canceled']
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated. SID: ${activeCallSid}`);

        // Update status only after successful call initiation
        clients[pendingIndex].status = 'CALLED';
        fs.writeFileSync(CLIENTS_PATH, JSON.stringify(clients, null, 2));

    } catch (error) {
        logger.error('Error in drip tick:', error);
        // Release lock on error
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) {
        logger.warn('Drip is already running.');
        return;
    }

    logger.info('Starting Smart Drip service...');
    dripInterval = setInterval(tick, POLLING_INTERVAL_MS);

    // Immediate execution
    tick();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip service stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid && activeCallSid === callSid) {
        logger.info(`Outbound call ended. Releasing lock for SID: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
