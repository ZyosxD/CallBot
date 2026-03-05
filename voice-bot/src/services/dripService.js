import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

export let isCallActive = false;
let dripInterval = null;

export const releaseCallLock = () => {
    isCallActive = false;
    logger.info('Call lock released');
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const timeValue = now.hour() * 100 + now.minute();

    // Morning: 9:30 AM (930) - 11:30 AM (1130)
    // Afternoon: 2:30 PM (1430) - 3:30 PM (1530)
    return (timeValue >= 930 && timeValue <= 1130) || (timeValue >= 1430 && timeValue <= 1530);
};

export const startDrip = () => {
    if (!config.server.publicUrl) {
        logger.warn('PUBLIC_URL is not set. Drip Service will NOT start.');
        return;
    }
    logger.info('Starting Smart Drip Service');

    // Check every 30 seconds
    dripInterval = setInterval(executeNextCall, 30000);
    // Execute immediately on start
    executeNextCall();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Service stopped.');
    }
};

const executeNextCall = async () => {
    if (isCallActive) {
        logger.info('A call is currently active. Skipping this cycle.');
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside operating hours in America/Denver timezone. Skipping.');
        return;
    }

    try {
        const rawData = fs.readFileSync(clientsPath, 'utf-8');
        let clients = JSON.parse(rawData);

        const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

        if (nextClientIndex === -1) {
            logger.info('No pending clients found. Smart Drip idle.');
            return;
        }

        isCallActive = true;

        const client = clients[nextClientIndex];
        // Mark immediately to avoid duplicate processing
        clients[nextClientIndex].status = 'CALLED';
        fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

        logger.info(`Initiating outbound call to ${client.name} (${client.phone})`);

        const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

        const VoiceResponse = twilio.twiml.VoiceResponse;
        const response = new VoiceResponse();
        const connect = response.connect();
        const stream = connect.stream({
            url: `wss://${config.server.publicUrl.replace('https://', '').replace('http://', '')}/voice/stream`,
        });

        stream.parameter({ name: 'mode', value: 'outbound' });
        stream.parameter({ name: 'callerId', value: client.phone });

        await clientTwilio.calls.create({
            twiml: response.toString(),
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer', 'canceled'],
        });

    } catch (error) {
        logger.error(`Error in Smart Drip execution: ${error.message}`);
        releaseCallLock(); // Ensure lock is released on error
    }
};
