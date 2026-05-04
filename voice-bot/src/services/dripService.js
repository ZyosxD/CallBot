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

const clientsPath = path.resolve('src/data/clients.json');
let twilioClient;

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const initializeTwilio = () => {
    if (!twilioClient && config.twilio.accountSid && config.twilio.authToken) {
        twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    }
    return twilioClient;
};

const isWithinOperatingHours = () => {
    const nowDenver = dayjs().tz('America/Denver');

    // Morning: 9:30 AM - 11:30 AM
    const morningStart = nowDenver.hour(9).minute(30).second(0);
    const morningEnd = nowDenver.hour(11).minute(30).second(0);

    // Afternoon: 2:30 PM - 3:30 PM
    const afternoonStart = nowDenver.hour(14).minute(30).second(0);
    const afternoonEnd = nowDenver.hour(15).minute(30).second(0);

    return nowDenver.isBetween(morningStart, morningEnd) || nowDenver.isBetween(afternoonStart, afternoonEnd);
};

const readClients = () => {
    try {
        if (!fs.existsSync(clientsPath)) {
            return [];
        }
        const data = fs.readFileSync(clientsPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return [];
    }
};

const writeClients = (clients) => {
    try {
        fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
    } catch (error) {
        logger.error('Error writing clients.json:', error);
    }
};

export const startDrip = () => {
    if (dripInterval) {
        logger.warn('Drip is already running.');
        return;
    }

    logger.info('Starting Smart Drip service...');
    dripInterval = setInterval(processDrip, 15000); // Check every 15 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip service stopped.');
    }
};

const processDrip = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        // Just return, keep the polling active
        return;
    }

    const clients = readClients();
    const pendingIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingIndex === -1) {
        // No pending clients, wait.
        return;
    }

    isCallActive = true;
    const targetClient = clients[pendingIndex];

    try {
        const client = initializeTwilio();
        if (!client) {
            throw new Error('Twilio client not initialized.');
        }

        logger.info(`Initiating outbound call to ${targetClient.phone}`);

        const twiml = `
            <Response>
                <Connect>
                    <Stream url="wss://${config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : 'localhost:3000'}/voice/stream">
                        <Parameter name="callerId" value="${targetClient.phone}" />
                        <Parameter name="mode" value="outbound" />
                    </Stream>
                </Connect>
            </Response>
        `;

        const publicUrlWithProto = config.server.publicUrl ? config.server.publicUrl : 'http://localhost:3000';

        const call = await client.calls.create({
            twiml: twiml,
            to: targetClient.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${publicUrlWithProto}/voice/inbound/status`,
            statusCallbackMethod: 'POST'
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated. CallSid: ${activeCallSid}`);

        // Mark as called immediately after successful API creation to avoid duplicates
        clients[pendingIndex].status = 'CALLED';
        writeClients(clients);

    } catch (error) {
        logger.error('Failed to create outbound call:', error);
        isCallActive = false; // release lock if it fails to connect
        activeCallSid = null;
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Releasing lock for CallSid: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
