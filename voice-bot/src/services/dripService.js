import twilio from 'twilio';
import fs from 'fs/promises';
import path from 'path';
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

const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;
let twilioClient;

if (config.twilio.accountSid && config.twilio.authToken) {
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
}

const isWithinOperatingHours = () => {
    const nowDenver = dayjs().tz('America/Denver');

    const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
    const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);

    const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
    const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

    return nowDenver.isBetween(morningStart, morningEnd) || nowDenver.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
    if (dripInterval) return;
    logger.info('Starting Smart Drip Engine...');
    dripInterval = setInterval(processNextCall, 15000); // Check every 15 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped.');
    }
};

const processNextCall = async () => {
    if (isCallActive) return;
    if (!isWithinOperatingHours()) {
        logger.debug('Outside operating hours. Waiting...');
        return;
    }

    if (!config.server.publicUrl || !twilioClient) {
        logger.warn('Server public URL or Twilio credentials not configured. Cannot process drip.');
        return;
    }

    try {
        const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
        let clients = JSON.parse(data);

        const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
        if (nextClientIndex === -1) {
             logger.info('No PENDING clients left in the queue.');
             return;
        }

        const clientToCall = clients[nextClientIndex];

        // Mark as called immediately before placing the call to avoid dupes
        clients[nextClientIndex].status = 'CALLED';
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf-8');

        logger.info(`Initiating outbound call to ${clientToCall.phone}...`);
        isCallActive = true;

        const publicUrl = config.server.publicUrl.replace(/\/$/, "");

        // Pass callerId (client phone) and mode (outbound) to inbound endpoint which generates TwiML
        // TwiML endpoint logic should handle mapping it or creating stream.
        // Or directly construct TwiML inline. We will pass a TwiML string to `calls.create` or URL.
        const encodedPhone = encodeURIComponent(clientToCall.phone);

        const twimlUrl = `${publicUrl}/voice/outbound?callerId=${encodedPhone}&mode=outbound`;

        const call = await twilioClient.calls.create({
            url: twimlUrl,
            to: clientToCall.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${publicUrl}/voice/inbound/status`,
            // Empty array means ALL events
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated. SID: ${activeCallSid}`);

    } catch (error) {
        logger.error('Error processing next call in drip:', error);
        isCallActive = false; // Reset lock on error
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid && activeCallSid === callSid) {
        logger.info(`Releasing lock for call SID: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
