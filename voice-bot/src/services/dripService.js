import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export let activeCallSid = null;
export let isCallActive = false;
let dripInterval = null;

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Outbound call ${callSid} ended, unlocking drip service.`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const hour = now.hour();
    const minute = now.minute();
    const currentTime = hour + minute / 60;

    // Morning: 9:30 AM - 11:30 AM
    const isMorning = currentTime >= 9.5 && currentTime < 11.5;
    // Afternoon: 2:30 PM - 3:30 PM
    const isAfternoon = currentTime >= 14.5 && currentTime < 15.5;

    return isMorning || isAfternoon;
};

const executeDrip = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        return;
    }

    const clientsPath = path.join(__dirname, '..', 'data', 'clients.json');
    if (!fs.existsSync(clientsPath)) {
        logger.warn('clients.json not found, skipping drip.');
        return;
    }

    let clients;
    try {
        clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
    } catch (e) {
        logger.error('Error parsing clients.json:', e);
        return;
    }

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        return;
    }

    const client = clients[nextClientIndex];

    try {
        // Mark as CALLED immediately to avoid duplicates
        clients[nextClientIndex].status = 'CALLED';
        fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

        isCallActive = true;

        logger.info(`Initiating outbound call to ${client.phone} (${client.name})`);

        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Generate TwiML inline to connect to WebSocket
        const TwiML = `
            <Response>
                <Connect>
                    <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
                        <Parameter name="mode" value="outbound" />
                        <Parameter name="callerId" value="${client.phone}" />
                    </Stream>
                </Connect>
            </Response>
        `;

        const call = await twilioClient.calls.create({
            twiml: TwiML,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['completed'],
            statusCallbackMethod: 'POST'
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated with SID: ${activeCallSid}`);

    } catch (error) {
        logger.error(`Error initiating call to ${client.phone}:`, error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDripService = () => {
    logger.info('Starting Smart Drip Service...');
    // Check every 30 seconds
    dripInterval = setInterval(executeDrip, 30000);
    // Run immediately once
    executeDrip();
};

export const stopDrip = () => {
    logger.info('Stopping Smart Drip Service...');
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
    }
};
