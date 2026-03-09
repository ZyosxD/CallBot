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
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let twilioClient;
let isCallActive = false;
let dripInterval;

const initializeTwilio = () => {
    if (!twilioClient && config.twilio.accountSid && config.twilio.authToken) {
        twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    }
    return twilioClient;
};

const getClients = () => {
    try {
        const data = fs.readFileSync(clientsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return [];
    }
};

const saveClients = (clients) => {
    try {
        fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf8');
    } catch (error) {
        logger.error('Error writing to clients.json:', error);
    }
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const hour = now.hour();
    const minute = now.minute();
    const timeInMinutes = hour * 60 + minute;

    // Morning: 9:30 AM - 11:30 AM
    const morningStart = 9 * 60 + 30;
    const morningEnd = 11 * 60 + 30;

    // Afternoon: 2:30 PM - 3:30 PM
    const afternoonStart = 14 * 60 + 30;
    const afternoonEnd = 15 * 60 + 30;

    return (timeInMinutes >= morningStart && timeInMinutes < morningEnd) ||
           (timeInMinutes >= afternoonStart && timeInMinutes < afternoonEnd);
};

const executeNextCall = async () => {
    if (isCallActive) {
        logger.info('Drip Service: Call currently active. Waiting...');
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Drip Service: Outside operating hours. Waiting...');
        return;
    }

    const clients = getClients();
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
        logger.info('Drip Service: No pending clients found. Waiting...');
        return;
    }

    const client = clients[pendingClientIndex];

    // Mark as CALLED immediately to prevent duplicate calls
    clients[pendingClientIndex].status = 'CALLED';
    saveClients(clients);

    isCallActive = true;
    logger.info(`Drip Service: Initiating call to ${client.name} at ${client.phone}`);

    const clientObj = initializeTwilio();
    if (!clientObj) {
        logger.error('Drip Service: Twilio client not initialized. Cannot make call.');
        isCallActive = false;
        return;
    }

    try {
        const wssUrl = config.server.publicUrl.replace('https://', 'wss://').replace('http://', 'ws://');

        // Inline TwiML to avoid external dependencies
        const twiml = `
            <Response>
                <Connect>
                    <Stream url="${wssUrl}/voice/stream">
                        <Parameter name="mode" value="outbound" />
                        <Parameter name="callerId" value="${client.phone}" />
                    </Stream>
                </Connect>
            </Response>
        `;

        await clientObj.calls.create({
            twiml: twiml,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['completed'],
            statusCallbackMethod: 'POST'
        });

        logger.info(`Drip Service: Outbound call requested via Twilio for ${client.phone}`);
    } catch (error) {
        logger.error('Drip Service: Error creating outbound call:', error);
        isCallActive = false; // Release lock on error
    }
};

export const startDrip = () => {
    if (dripInterval) {
        logger.warn('Drip Service: Already running.');
        return;
    }
    logger.info('Drip Service: Starting Smart Drip Engine...');
    dripInterval = setInterval(executeNextCall, 60000); // Check every minute
    // Run once immediately
    executeNextCall();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Drip Service: Stopped Smart Drip Engine.');
    }
};

export const handleCallEnded = () => {
    logger.info('Drip Service: Call ended event received. Releasing lock.');
    isCallActive = false;
};
