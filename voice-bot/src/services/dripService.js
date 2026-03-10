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

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
    // Current time in Denver
    const nowDenver = dayjs().tz('America/Denver');
    const hour = nowDenver.hour();
    const minute = nowDenver.minute();
    const currentTimeMinutes = hour * 60 + minute;

    // Morning: 9:30 AM (570) to 11:30 AM (690)
    // Afternoon: 2:30 PM (870) to 3:30 PM (930)

    const isMorning = currentTimeMinutes >= 570 && currentTimeMinutes < 690;
    const isAfternoon = currentTimeMinutes >= 870 && currentTimeMinutes < 930;

    return isMorning || isAfternoon;
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Lock released for CallSid: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const executeNextCall = async () => {
    if (isCallActive) {
        return; // Wait for current call to finish
    }

    if (!isWithinOperatingHours()) {
        return; // Outside of operating hours, do nothing
    }

    const clientsPath = path.join(__dirname, '../data/clients.json');
    let clients = [];

    try {
        if (fs.existsSync(clientsPath)) {
            clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
        } else {
            logger.warn('clients.json not found, Drip Engine waiting.');
            return;
        }
    } catch (e) {
        logger.error('Error reading clients.json for Drip Engine', e);
        return;
    }

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        // No more pending clients
        return;
    }

    const client = clients[nextClientIndex];

    // Lock it immediately
    clients[nextClientIndex].status = 'CALLED';
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

    isCallActive = true;

    try {
        const publicUrl = config.server.publicUrl.replace(/\/$/, "");
        const host = new URL(publicUrl).host;

        // Generate TwiML inline to start the WebSocket stream with custom parameters
        const twiml = new twilio.twiml.VoiceResponse();
        const connect = twiml.connect();
        const stream = connect.stream({
            url: `wss://${host}/voice/stream`,
        });

        stream.parameter({ name: 'callerId', value: client.phone });
        stream.parameter({ name: 'mode', value: 'outbound' });

        const call = await twilioClient.calls.create({
            twiml: twiml.toString(),
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['completed']
        });

        activeCallSid = call.sid;
        logger.info(`Outbound call initiated to ${client.phone} with SID: ${call.sid}`);

    } catch (error) {
        logger.error(`Error initiating outbound call to ${client.phone}:`, error);
        // Release lock on failure so the queue doesn't get stuck permanently
        // Note: The lead is still marked as CALLED, which is safe to avoid infinite retries
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (!config.server.publicUrl) {
         logger.warn('PUBLIC_URL is not set. Drip Service will not start.');
         return;
    }

    logger.info('Smart Drip Engine Started');
    // Check every 10 seconds if we can make a call
    dripInterval = setInterval(executeNextCall, 10000);
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine Stopped');
    }
};
