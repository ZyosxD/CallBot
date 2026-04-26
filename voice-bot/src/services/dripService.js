import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');

    const morningStart = denverTime.set('hour', 9).set('minute', 30).set('second', 0);
    const morningEnd = denverTime.set('hour', 11).set('minute', 30).set('second', 0);

    const afternoonStart = denverTime.set('hour', 14).set('minute', 30).set('second', 0);
    const afternoonEnd = denverTime.set('hour', 15).set('minute', 30).set('second', 0);

    return denverTime.isBetween(morningStart, morningEnd) || denverTime.isBetween(afternoonStart, afternoonEnd);
};

const getClients = () => {
    try {
        if (!fs.existsSync(clientsFilePath)) return [];
        const data = fs.readFileSync(clientsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        logger.error(`Error reading clients.json: ${err}`);
        return [];
    }
};

const saveClients = (clients) => {
    try {
        fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
    } catch (err) {
        logger.error(`Error writing to clients.json: ${err}`);
    }
};

const initiateCall = async (client) => {
    try {
        const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

        const hostUrl = config.server.publicUrl ? config.server.publicUrl : `http://localhost:${config.server.port}`;
        // Encode phone number (callerId) to ensure it's safely passed in URL
        const callerIdUrlParam = encodeURIComponent(client.phone);

        const call = await clientTwilio.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            url: `${hostUrl}/voice/inbound?mode=outbound&callerId=${callerIdUrlParam}`,
            statusCallback: `${hostUrl}/voice/inbound/status`,
        });

        activeCallSid = call.sid;
        logger.info(`Started outbound call to ${client.phone}, SID: ${call.sid}`);
    } catch (error) {
        logger.error(`Failed to initiate outbound call to ${client.phone}: ${error}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const dripTick = async () => {
    if (isCallActive) return;

    if (!checkOperatingHours()) return;

    const clients = getClients();
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) return;

    isCallActive = true;
    const client = clients[pendingClientIndex];

    logger.info(`Found pending client: ${client.phone}. Initiating call...`);

    // Mark as CALLED immediately before the call API is hit
    clients[pendingClientIndex].status = 'CALLED';
    saveClients(clients);

    await initiateCall(client);
};

export const startDrip = () => {
    logger.info('Starting Smart Drip polling...');
    // Poll every 10 seconds
    dripInterval = setInterval(dripTick, 10000);
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Stopped Smart Drip polling.');
    }
};

export const markCallEnded = (callSid) => {
    if (callSid === activeCallSid) {
        logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};
