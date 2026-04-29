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

const TIMEZONE = 'America/Denver';

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const getClientsFilePath = () => path.resolve(process.cwd(), 'src/data/clients.json');

const readClients = () => {
    try {
        const filePath = getClientsFilePath();
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, '[]');
            return [];
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return [];
    }
};

const writeClients = (clients) => {
    try {
        fs.writeFileSync(getClientsFilePath(), JSON.stringify(clients, null, 2));
    } catch (error) {
        logger.error('Error writing clients.json:', error);
    }
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz(TIMEZONE);

    const morningStart = dayjs().tz(TIMEZONE).hour(9).minute(30).second(0);
    const morningEnd = dayjs().tz(TIMEZONE).hour(11).minute(30).second(0);

    const afternoonStart = dayjs().tz(TIMEZONE).hour(14).minute(30).second(0);
    const afternoonEnd = dayjs().tz(TIMEZONE).hour(15).minute(30).second(0);

    return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const processNextCall = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside of Mountain Time operating hours. Waiting...');
        return;
    }

    const clients = readClients();
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
        logger.info('No pending clients to call.');
        return;
    }

    const client = clients[pendingClientIndex];
    isCallActive = true;

    try {
        logger.info(`Initiating outbound call to ${client.phone} (${client.name})`);

        const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Use client's phone for outbound routing
        const call = await clientTwilio.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            url: `${config.server.publicUrl}/voice/inbound`,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
            statusCallbackMethod: 'POST',
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated with SID: ${activeCallSid}`);

        // Mark as CALLED immediately after successfully initiating the API call
        clients[pendingClientIndex].status = 'CALLED';
        clients[pendingClientIndex].callSid = activeCallSid;
        clients[pendingClientIndex].calledAt = new Date().toISOString();
        writeClients(clients);

    } catch (error) {
        logger.error('Error initiating outbound call:', error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) {
        logger.warn('Smart Drip is already running.');
        return;
    }

    if (!config.twilio.accountSid || !config.twilio.authToken || !config.server.publicUrl) {
       logger.warn('Twilio config or PUBLIC_URL missing. Smart Drip disabled.');
       return;
    }

    logger.info('Starting Smart Drip engine...');
    // Check every 30 seconds
    dripInterval = setInterval(processNextCall, 30000);
    // Trigger first check immediately
    processNextCall();
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
        logger.info(`Lock released for outbound call SID: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
