import fs from 'fs/promises';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');
const TIMEZONE = 'America/Denver';

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkTimeWindow = () => {
    const now = dayjs().tz(TIMEZONE);

    // Morning: 9:30 AM - 11:30 AM MT
    const morningStart = now.hour(9).minute(30).second(0);
    const morningEnd = now.hour(11).minute(30).second(0);

    // Afternoon: 2:30 PM - 3:30 PM MT
    const afternoonStart = now.hour(14).minute(30).second(0);
    const afternoonEnd = now.hour(15).minute(30).second(0);

    return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const executeDripCall = async () => {
    if (isCallActive) {
        return; // Wait for current call to finish
    }

    if (!checkTimeWindow()) {
        return; // Outside of allowed calling hours
    }

    try {
        let clients = [];
        try {
            const fileData = await fs.readFile(CLIENTS_FILE, 'utf8');
            if (fileData) {
                clients = JSON.parse(fileData);
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.error('Error reading clients file:', err);
            }
            return;
        }

        const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
        if (nextClientIndex === -1) {
            return; // No pending clients left
        }

        const client = clients[nextClientIndex];

        // Mark as called immediately to prevent duplicates
        clients[nextClientIndex].status = 'CALLED';
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf8');

        isCallActive = true;
        logger.info(`Starting outbound call to ${client.phone} (${client.name})`);

        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        const twimlUrl = new URL(`${config.server.publicUrl}/voice/outbound`);
        twimlUrl.searchParams.append('callerId', client.phone);

        const call = await twilioClient.calls.create({
            twiml: `<Response><Connect><Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream"><Parameter name="callerId" value="${client.phone}" /><Parameter name="mode" value="outbound" /></Stream></Connect></Response>`,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated. SID: ${call.sid}`);

    } catch (error) {
        logger.error('Error executing drip call:', error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) {
        return;
    }
    logger.info('Starting Smart Drip engine...');
    // Poll every 30 seconds
    dripInterval = setInterval(executeDripCall, 30000);
    // Execute immediately on start
    executeDripCall();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip engine stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid && activeCallSid === callSid) {
        logger.info(`Releasing lock for call SID: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
