import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const clientsFile = path.resolve('clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const getClients = () => {
    try {
        if (!fs.existsSync(clientsFile)) return [];
        const data = fs.readFileSync(clientsFile, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        logger.error('Error reading clients.json:', e);
        return [];
    }
};

const saveClients = (clients) => {
    try {
        fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
    } catch (e) {
        logger.error('Error writing to clients.json:', e);
    }
};

const isWithinCallingHours = () => {
    const now = dayjs().tz('America/Denver');
    const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
    const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);
    const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
    const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

    return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const makeNextCall = async () => {
    if (isCallActive) return;

    if (!isWithinCallingHours()) {
        logger.info('Outside of Mountain Time calling hours. Waiting...');
        return;
    }

    const clients = getClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        logger.info('No more PENDING clients to call.');
        return;
    }

    isCallActive = true;
    const client = clients[nextClientIndex];
    logger.info(`Initiating call to ${client.name} at ${client.phone}`);

    try {
        const clientInstance = twilio(config.twilio.accountSid, config.twilio.authToken);

        const call = await clientInstance.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            twiml: `<Response><Connect><Stream url="${config.server.publicUrl.replace('http', 'ws')}/voice/stream"><Parameter name="callerId" value="${client.phone}"/><Parameter name="mode" value="outbound"/></Stream></Connect></Response>`,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
        });

        activeCallSid = call.sid;
        logger.info(`Call created successfully with SID ${activeCallSid}`);

        // Mark as CALLED immediately
        clients[nextClientIndex].status = 'CALLED';
        saveClients(clients);

    } catch (error) {
        logger.error(`Failed to make call to ${client.phone}:`, error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) return;
    logger.info('Starting Smart Drip Engine...');

    // Initial creation of clients.json if it doesn't exist to avoid crashing
    if (!fs.existsSync(clientsFile)) {
        saveClients([]);
    }

    dripInterval = setInterval(makeNextCall, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (callSid && callSid === activeCallSid) {
        logger.info(`Releasing outbound lock for CallSid ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
