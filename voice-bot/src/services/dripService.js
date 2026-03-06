import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isCallActive = false;
let currentCallSid = null;
let dripInterval = null;

const getClientsFile = () => path.join(__dirname, '../data/clients.json');

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const hour = now.hour();
    const minute = now.minute();
    const timeInMinutes = hour * 60 + minute;

    const morningStart = 9 * 60 + 30; // 9:30 AM
    const morningEnd = 11 * 60 + 30; // 11:30 AM

    const afternoonStart = 14 * 60 + 30; // 2:30 PM
    const afternoonEnd = 15 * 60 + 30; // 3:30 PM

    return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
           (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

const executeNextCall = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside of operating hours for drip campaign.');
        return;
    }

    const clientsFile = getClientsFile();
    if (!fs.existsSync(clientsFile)) {
        logger.warn('clients.json not found. Creating empty file.');
        fs.writeFileSync(clientsFile, JSON.stringify([]));
        return;
    }

    let clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        logger.info('No pending clients found for the drip campaign.');
        return;
    }

    isCallActive = true;
    const client = clients[nextClientIndex];

    // Mark as called immediately to prevent duplicates
    clients[nextClientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

    logger.info(`Initiating outbound call to ${client.name} at ${client.phone}`);

    const clientPhone = client.phone; // E.164 format

    // Generate inline TwiML
    const twiml = `
        <Response>
            <Connect>
                <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
                    <Parameter name="callerId" value="${clientPhone}" />
                    <Parameter name="mode" value="outbound" />
                </Stream>
            </Connect>
        </Response>
    `;

    try {
        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
        const call = await twilioClient.calls.create({
            twiml: twiml,
            to: clientPhone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer', 'canceled']
        });

        currentCallSid = call.sid;
        logger.info(`Call initiated. SID: ${currentCallSid}`);
    } catch (error) {
        logger.error(`Failed to initiate call to ${clientPhone}:`, error);
        isCallActive = false;
        currentCallSid = null;
    }
};

export const startDrip = () => {
    logger.info('Starting Smart Drip Engine...');
    // Check every 30 seconds
    dripInterval = setInterval(executeNextCall, 30000);
    // Attempt one immediately
    executeNextCall();
};

export const stopDrip = () => {
    logger.info('Stopping Smart Drip Engine...');
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
    }
};

export const handleCallEnd = (callSid) => {
    if (callSid === currentCallSid) {
        logger.info(`Call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        currentCallSid = null;
    }
};