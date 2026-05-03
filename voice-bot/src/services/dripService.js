import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');

    const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
    const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);

    const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
    const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

    return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
    if (dripInterval) return;
    logger.info('Starting Smart Drip Engine');

    dripInterval = setInterval(async () => {
        if (!isWithinOperatingHours()) {
            logger.info('Smart Drip: Outside operating hours (MT 9:30-11:30 & 14:30-15:30). Waiting...');
            return;
        }

        if (isCallActive) {
            logger.info('Smart Drip: Call is currently active. Waiting...');
            return;
        }

        try {
            const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
            let clients = JSON.parse(data);

            const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
            if (nextClientIndex === -1) {
                logger.info('Smart Drip: No pending clients found. Waiting...');
                return;
            }

            const client = clients[nextClientIndex];
            logger.info(`Smart Drip: Initiating call to ${client.phone}`);

            // Lock
            isCallActive = true;

            const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
            const call = await twilioClient.calls.create({
                to: client.phone,
                from: config.twilio.phoneNumber,
                url: `${config.server.publicUrl}/voice/inbound`,
                statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
            });

            activeCallSid = call.sid;
            logger.info(`Call initiated. SID: ${activeCallSid}`);

            // Mark as CALLED
            clients[nextClientIndex].status = 'CALLED';
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

        } catch (error) {
            logger.error('Smart Drip Error:', error);
            isCallActive = false;
            activeCallSid = null;
        }
    }, 60000); // Check every 60 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid && activeCallSid === callSid) {
        logger.info(`Releasing lock for CallSid: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
