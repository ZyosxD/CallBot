import fs from 'fs';
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

const clientsFilePath = path.resolve('src/data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkOperatingHours = () => {
    const now = dayjs().tz('America/Denver');

    const morningStart = now.hour(9).minute(30).second(0);
    const morningEnd = now.hour(11).minute(30).second(0);

    const afternoonStart = now.hour(14).minute(30).second(0);
    const afternoonEnd = now.hour(15).minute(30).second(0);

    return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
    if (dripInterval) {
        logger.warn('Drip campaign is already running.');
        return;
    }

    logger.info('Starting Smart Drip Engine...');
    dripInterval = setInterval(processDripQueue, 15000); // Check every 15 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Releasing lock for call ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const processDripQueue = async () => {
    if (isCallActive) {
        return; // Wait for the active call to finish
    }

    if (!checkOperatingHours()) {
        return; // Outside of operating hours, just wait
    }

    try {
        if (!fs.existsSync(clientsFilePath)) {
            logger.warn('clients.json not found. Drip paused.');
            return;
        }

        const data = fs.readFileSync(clientsFilePath, 'utf8');
        let clients = JSON.parse(data);

        const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

        if (nextClientIndex === -1) {
            return; // No pending clients, wait
        }

        const client = clients[nextClientIndex];

        // Mark as called immediately before placing the call to avoid race conditions
        clients[nextClientIndex].status = 'CALLED';
        fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));

        isCallActive = true;

        logger.info(`Dialing ${client.name} at ${client.phone}...`);

        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Use client phone number as callerId parameter for the outbound call
        const twimlUrl = `${config.server.publicUrl}/voice/inbound`;

        const call = await twilioClient.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            url: twimlUrl,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
            // Do not restrict statusCallbackEvent with an array to ensure all callbacks are received
        });

        activeCallSid = call.sid;
        logger.info(`Outbound call initiated with SID: ${call.sid}`);

    } catch (error) {
        logger.error(`Error in Smart Drip process: ${error.message}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
