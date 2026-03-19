import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

// Ensure clients.json exists
const ensureClientsFile = () => {
    if (!fs.existsSync(clientsFilePath)) {
        fs.mkdirSync(path.dirname(clientsFilePath), { recursive: true });
        fs.writeFileSync(clientsFilePath, JSON.stringify([], null, 2));
    }
};

const readClients = () => {
    ensureClientsFile();
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    return JSON.parse(data);
};

const writeClients = (data) => {
    fs.writeFileSync(clientsFilePath, JSON.stringify(data, null, 2));
};

export const markCallEnded = (CallSid) => {
    if (activeCallSid === CallSid) {
        logger.info(`Drip Engine: Releasing lock for CallSid ${CallSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');
    const hour = denverTime.hour();
    const minute = denverTime.minute();

    const currentMinutes = hour * 60 + minute;

    // 9:30 AM (9*60+30=570) to 11:30 AM (11*60+30=690)
    // 2:30 PM (14*60+30=870) to 3:30 PM (15*60+30=930)

    const isMorning = currentMinutes >= 570 && currentMinutes < 690;
    const isAfternoon = currentMinutes >= 870 && currentMinutes < 930;

    return isMorning || isAfternoon;
};

const processNextCall = async () => {
    if (isCallActive) {
        return; // Wait for current call to finish
    }

    if (!isWithinOperatingHours()) {
        return; // Outside of operating hours
    }

    const clients = readClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        return; // No pending clients left
    }

    const client = clients[nextClientIndex];
    isCallActive = true;

    // Mark as called BEFORE executing to prevent mathematical duplicates
    clients[nextClientIndex].status = 'CALLED';
    writeClients(clients);

    logger.info(`Drip Engine: Initiating call to ${client.name} (${client.phone})`);

    try {
        const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Use inline TwiML directly via REST API (Twilio requires passing only 'completed' in statusCallbackEvent array)
        // Ensure no url parameter is sent.
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

        const call = await clientTwilio.calls.create({
            twiml: twiml,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['completed']
        });

        activeCallSid = call.sid;
        logger.info(`Drip Engine: Call initiated successfully with CallSid ${call.sid}`);

    } catch (error) {
        logger.error(`Drip Engine Error initiating call to ${client.phone}: ${error}`);
        // Ensure lock is released if it fails immediately
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
    }
    logger.info('Drip Engine: Started monitoring for outbound calls (Interval: 15s)');
    dripInterval = setInterval(() => {
        processNextCall();
    }, 15000);
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Drip Engine: Stopped monitoring');
    }
};
