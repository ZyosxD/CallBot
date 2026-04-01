import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
export let isCallActive = false;
export let activeCallSid = null;

const getClients = () => {
    try {
        if (!fs.existsSync(clientsFilePath)) return [];
        const data = fs.readFileSync(clientsFilePath, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        logger.error('Error reading clients.json:', e);
        return [];
    }
};

const saveClients = (clients) => {
    try {
        fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
    } catch (e) {
        logger.error('Error writing clients.json:', e);
    }
};

export const markCallEnded = (callSid) => {
    if (callSid === activeCallSid) {
        logger.info(`Call ended properly. Releasing lock for ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');
    const hours = denverTime.hour();
    const minutes = denverTime.minute();
    const timeInMinutes = hours * 60 + minutes;

    const morningStart = 9 * 60 + 30; // 9:30 AM
    const morningEnd = 11 * 60 + 30; // 11:30 AM
    const afternoonStart = 14 * 60 + 30; // 2:30 PM
    const afternoonEnd = 15 * 60 + 30; // 3:30 PM

    return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
           (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

export const executeDrip = async () => {
    if (!isWithinOperatingHours()) {
        logger.info('Outside of operating hours (Denver Time). Waiting...');
        return;
    }

    if (isCallActive) {
        logger.info('A call is currently active. Waiting for it to finish...');
        return;
    }

    const clients = getClients();
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
        logger.info('No pending clients left to call. Waiting...');
        return;
    }

    const client = clients[pendingClientIndex];

    // Set lock
    isCallActive = true;

    logger.info(`Executing call to ${client.name} at ${client.phone}`);

    const clientPhone = client.phone;

    // Determine the TwiML URL
    const publicUrlNoProto = config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : 'localhost:3000';

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    try {
        // We omit statusCallbackEvent to receive all to release lock
        const call = await twilioClient.calls.create({
            to: clientPhone,
            from: config.twilio.phoneNumber,
            twiml: `
                <Response>
                    <Connect>
                        <Stream url="wss://${publicUrlNoProto}/voice/stream">
                            <Parameter name="mode" value="outbound" />
                            <Parameter name="callerId" value="${clientPhone}" />
                        </Stream>
                    </Connect>
                </Response>`,
            statusCallback: config.server.publicUrl + '/voice/status',
        });

        activeCallSid = call.sid;

        // Mark as called right after initiating
        clients[pendingClientIndex].status = 'CALLED';
        saveClients(clients);

        logger.info(`Call initiated. SID: ${call.sid}`);

    } catch (e) {
        logger.error('Failed to initiate call via Twilio:', e);
        // Release lock
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    logger.info('Starting Smart Drip service...');
    dripInterval = setInterval(executeDrip, 15000); // Check every 15s
};

export const stopDrip = () => {
    logger.info('Stopping Smart Drip service...');
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
    }
};
