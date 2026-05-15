import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');

    // 9:30 AM - 11:30 AM Mountain Time
    const morningStart = denverTime.hour(9).minute(30).second(0);
    const morningEnd = denverTime.hour(11).minute(30).second(0);

    // 2:30 PM - 3:30 PM Mountain Time
    const afternoonStart = denverTime.hour(14).minute(30).second(0);
    const afternoonEnd = denverTime.hour(15).minute(30).second(0);

    return denverTime.isBetween(morningStart, morningEnd) || denverTime.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
    if (dripInterval) return;

    logger.info('Starting Smart Drip Engine polling...');

    // Poll every 30 seconds
    dripInterval = setInterval(async () => {
        if (isCallActive) {
            return; // Wait for current call to finish
        }

        if (!isWithinOperatingHours()) {
             // Just return, keep polling alive
             return;
        }

        try {
            let clients = [];
            if (fs.existsSync(CLIENTS_FILE)) {
                clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'));
            }

            // Find first pending contact
            const pendingContactIndex = clients.findIndex(c => c.status === 'PENDING');

            if (pendingContactIndex === -1) {
                return; // No pending contacts, wait for next cycle
            }

            const contactToCall = clients[pendingContactIndex];
            logger.info(`Initiating Smart Drip call to ${contactToCall.phone}`);

            // Lock the system
            isCallActive = true;

            const client = twilio(config.twilio.accountSid, config.twilio.authToken);

            const call = await client.calls.create({
                to: contactToCall.phone,
                from: config.twilio.phoneNumber,
                twiml: `<Response><Connect><Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream"><Parameter name="mode" value="outbound" /><Parameter name="callerId" value="${contactToCall.phone}" /></Stream></Connect></Response>`,
                statusCallback: `${config.server.publicUrl}/voice/inbound/status`
                // Intentionally omitted statusCallbackEvent array so we receive all terminal states
            });

            activeCallSid = call.sid;
            logger.info(`Outbound call initiated: ${activeCallSid}`);

            // Mark as called ONLY after successful initiation to prevent data loss
            clients[pendingContactIndex].status = 'CALLED';
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

        } catch (error) {
            logger.error('Error during Smart Drip execution:', error);
            // Release lock on error so it can try again
            isCallActive = false;
            activeCallSid = null;
        }

    }, 30000);
};

export const markCallEnded = (callSid) => {
    if (callSid && callSid === activeCallSid) {
        logger.info(`Releasing lock for call ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped.');
    }
};
