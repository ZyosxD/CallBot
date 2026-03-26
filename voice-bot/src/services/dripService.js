import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const getClients = () => {
    try {
        if (!fs.existsSync(clientsFilePath)) {
            fs.writeFileSync(clientsFilePath, '[]');
            return [];
        }
        const data = fs.readFileSync(clientsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return [];
    }
};

const saveClients = (clients) => {
    try {
        fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
    } catch (error) {
        logger.error('Error writing to clients.json:', error);
    }
};

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');
    const timeNum = denverTime.hour() * 100 + denverTime.minute();

    // Morning: 9:30 AM - 11:30 AM (930 - 1130)
    // Afternoon: 2:30 PM - 3:30 PM (1430 - 1530)
    return (timeNum >= 930 && timeNum <= 1130) || (timeNum >= 1430 && timeNum <= 1530);
};

export const markCallEnded = (callSid) => {
    if (callSid === activeCallSid) {
        logger.info(`Call ended lock released for ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const processNextCall = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside of Smart Drip operating hours. Waiting...');
        return;
    }

    let clients = getClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        logger.info('No pending clients left for Smart Drip.');
        return;
    }

    const client = clients[nextClientIndex];
    logger.info(`Starting outbound call to ${client.name} at ${client.phone}`);

    isCallActive = true;

    try {
        const clientPhone = client.phone;
        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        // We mark it as called IMMEDIATELY before initiating the Twilio call to prevent duplicates
        clients[nextClientIndex].status = 'CALLED';
        saveClients(clients);

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

        const call = await twilioClient.calls.create({
            twiml: twiml,
            to: clientPhone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`
        });

        activeCallSid = call.sid;
        logger.info(`Outbound call initiated. CallSid: ${call.sid}`);

    } catch (error) {
        logger.error('Failed to initiate outbound call:', error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) return;

    logger.info('Smart Drip engine started.');
    // Check every 30 seconds
    dripInterval = setInterval(processNextCall, 30000);

    // Initial trigger
    processNextCall();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip engine stopped.');
    }
};
