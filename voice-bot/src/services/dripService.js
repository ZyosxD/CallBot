import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientsFilePath = path.join(__dirname, '..', '..', 'clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const TIMEZONE = 'America/Denver';

const getClients = () => {
    try {
        if (!fs.existsSync(clientsFilePath)) {
            // Create empty clients file if not exists for safe startup
            fs.writeFileSync(clientsFilePath, JSON.stringify([], null, 2), 'utf8');
            return [];
        }
        const data = fs.readFileSync(clientsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error reading clients file:', error);
        return [];
    }
};

const updateClientStatus = (phone, status) => {
    try {
        const clients = getClients();
        const updatedClients = clients.map(c => {
            if (c.phone === phone) {
                return { ...c, status };
            }
            return c;
        });
        fs.writeFileSync(clientsFilePath, JSON.stringify(updatedClients, null, 2), 'utf8');
    } catch (error) {
        logger.error('Error updating client status:', error);
    }
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz(TIMEZONE);

    // Skip weekends
    if (now.day() === 0 || now.day() === 6) {
        return false;
    }

    const morningStart = dayjs().tz(TIMEZONE).hour(9).minute(30).second(0);
    const morningEnd = dayjs().tz(TIMEZONE).hour(11).minute(30).second(0);

    const afternoonStart = dayjs().tz(TIMEZONE).hour(14).minute(30).second(0); // 2:30 PM
    const afternoonEnd = dayjs().tz(TIMEZONE).hour(15).minute(30).second(0); // 3:30 PM

    const inMorning = now.isBetween(morningStart, morningEnd, null, '[]');
    const inAfternoon = now.isBetween(afternoonStart, afternoonEnd, null, '[]');

    return inMorning || inAfternoon;
};

const processNextCall = async () => {
    if (isCallActive) {
        return; // Wait for the active call to complete
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside of operating hours (Mountain Time). Waiting...');
        return;
    }

    const clients = getClients();
    const nextClient = clients.find(c => c.status === 'PENDING');

    if (!nextClient) {
        logger.info('No pending clients left to call. Waiting...');
        return;
    }

    isCallActive = true;
    const clientPhone = nextClient.phone;

    logger.info(`Initiating Smart Drip call to ${clientPhone}`);

    try {
        // Mark as called immediately to avoid mathematical duplicates
        updateClientStatus(clientPhone, 'CALLED');

        const client = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Pass callerId (clientPhone) directly in the URL to the websocket
        // Also add outbound-api Direction
        const twimlUrl = `${config.server.publicUrl}/voice/inbound`;

        const call = await client.calls.create({
            url: twimlUrl,
            to: clientPhone,
            from: config.twilio.phoneNumber,
            // Do not restrict statusCallbackEvent to ensure we get all events
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated. SID: ${activeCallSid}`);

    } catch (error) {
        logger.error(`Error initiating call to ${clientPhone}:`, error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) return;
    logger.info('Starting Smart Drip service...');
    // Poll every 15 seconds
    dripInterval = setInterval(processNextCall, 15000);
    processNextCall(); // Initial check
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip service stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};
