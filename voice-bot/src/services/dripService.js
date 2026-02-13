import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallInProgress = false; // Simple concurrency lock

export const loadClients = () => {
    try {
        if (!fs.existsSync(CLIENTS_FILE)) {
            return [];
        }
        const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error loading clients:', error);
        return [];
    }
};

export const saveClients = (clients) => {
    try {
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
    } catch (error) {
        logger.error('Error saving clients:', error);
    }
};

export const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const hour = now.hour();
    const minute = now.minute();
    const currentMinutes = hour * 60 + minute;

    // Morning: 9:30 (570) - 11:30 (690)
    const morningStart = 9 * 60 + 30;
    const morningEnd = 11 * 60 + 30;

    // Afternoon: 14:30 (870) - 15:30 (930)
    const afternoonStart = 14 * 60 + 30;
    const afternoonEnd = 15 * 60 + 30;

    const isMorning = currentMinutes >= morningStart && currentMinutes < morningEnd;
    const isAfternoon = currentMinutes >= afternoonStart && currentMinutes < afternoonEnd;

    return isMorning || isAfternoon;
};

export const getNextClient = () => {
    const clients = loadClients();
    return clients.find(c => c.status === 'PENDING');
};

export const updateClientStatus = (clientId, status) => {
    const clients = loadClients();
    const index = clients.findIndex(c => c.id === clientId);
    if (index !== -1) {
        clients[index].status = status;
        clients[index].lastCalled = new Date().toISOString();
        saveClients(clients);
    }
};

export const makeNextCall = async () => {
    if (isCallInProgress) {
        logger.info('Drip skipped: Call in progress.');
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Drip skipped: Outside operating hours (Mountain Time).');
        return;
    }

    const clientData = getNextClient();
    if (!clientData) {
        logger.info('Drip skipped: No pending clients.');
        return;
    }

    logger.info(`Initiating call for client: ${clientData.name} (${clientData.phone})`);

    // Mark as CALLED immediately to avoid duplicates
    updateClientStatus(clientData.id, 'CALLED');
    isCallInProgress = true;

    try {
        const client = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Use a publicly accessible URL for the TwiML
        // We need a route that returns TwiML for outbound calls
        // Since we are running on a server with public URL
        const outboundUrl = `${config.server.publicUrl}/voice/outbound-twiml?clientId=${clientData.id}`;

        const call = await client.calls.create({
            url: outboundUrl,
            to: clientData.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
        });

        logger.info(`Call initiated. SID: ${call.sid}`);

    } catch (error) {
        logger.error('Error initiating call:', error);
        isCallInProgress = false; // Reset lock on error
        // Optionally revert status or mark as FAILED
        updateClientStatus(clientData.id, 'FAILED');
    }
};

// Start the Drip Loop
export const startDrip = () => {
    if (dripInterval) return;

    logger.info('Starting Smart Drip Service...');

    // Check every minute
    dripInterval = setInterval(() => {
        makeNextCall();
    }, 60 * 1000);

    // Initial check
    makeNextCall();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Service stopped.');
    }
};

// Callback to release lock
export const callEnded = () => {
    isCallInProgress = false;
    logger.info('Call ended. Ready for next call.');
};
