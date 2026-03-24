import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const loadClients = () => {
    try {
        if (!fs.existsSync(CLIENTS_FILE)) {
            return [];
        }
        const data = fs.readFileSync(CLIENTS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        logger.error('Error loading clients.json:', err);
        return [];
    }
};

const saveClients = (clients) => {
    try {
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf-8');
    } catch (err) {
        logger.error('Error saving clients.json:', err);
    }
};

export const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const timeNum = now.hour() * 100 + now.minute();
    return (timeNum >= 930 && timeNum <= 1130) || (timeNum >= 1430 && timeNum <= 1530);
};

export const runDripCycle = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        return;
    }

    const clients = loadClients();
    const index = clients.findIndex(c => c.status === 'PENDING');

    if (index === -1) {
        return;
    }

    const client = clients[index];
    clients[index].status = 'CALLED';
    saveClients(clients);

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twiml = `
        <Response>
            <Connect>
                <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
                    <Parameter name="mode" value="outbound" />
                    <Parameter name="callerId" value="${client.phone}" />
                </Stream>
            </Connect>
        </Response>
    `;

    try {
        isCallActive = true;
        const call = await twilioClient.calls.create({
            twiml: twiml,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
        });
        activeCallSid = call.sid;
        logger.info(`Started outbound call to ${client.phone}, CallSid: ${call.sid}`);
    } catch (error) {
        logger.error(`Error starting outbound call to ${client.phone}:`, error);
        isCallActive = false;
        activeCallSid = null;
        clients[index].status = 'FAILED';
        saveClients(clients);
    }
};

export const startDrip = () => {
    if (!dripInterval) {
        dripInterval = setInterval(runDripCycle, 30000);
        logger.info('Smart Drip engine started.');
    }
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip engine stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        isCallActive = false;
        activeCallSid = null;
        logger.info(`Call ${callSid} ended, released drip lock.`);
    }
};
