import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
    if (dripInterval) {
        logger.info('Drip service already running.');
        return;
    }
    logger.info('Starting Drip Service...');
    // Check every minute
    dripInterval = setInterval(dripLoop, 60000);
    dripLoop(); // Run immediately on start
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Drip Service stopped.');
    }
};

export const setCallActive = (active) => {
    isCallActive = active;
    if (!active) {
        logger.info('Call ended, releasing lock.');
    }
};

const dripLoop = async () => {
    if (isCallActive) {
        logger.info('Call in progress, skipping drip cycle.');
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside operating hours.');
        return;
    }

    const nextClient = getNextClient();
    if (!nextClient) {
        logger.info('No pending clients found.');
        return;
    }

    await initiateCall(nextClient);
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const hour = now.hour();
    const minute = now.minute();

    // Morning: 9:30 - 11:30
    const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

    // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
    const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

    return isMorning || isAfternoon;
};

const getNextClient = () => {
    try {
        const data = fs.readFileSync(clientsPath, 'utf8');
        const clients = JSON.parse(data);
        return clients.find(c => c.status === 'PENDING');
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return null;
    }
};

const updateClientStatus = (clientId, status) => {
    try {
        const data = fs.readFileSync(clientsPath, 'utf8');
        const clients = JSON.parse(data);
        const index = clients.findIndex(c => c.id === clientId);
        if (index !== -1) {
            clients[index].status = status;
            fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
        }
    } catch (error) {
        logger.error('Error updating client status:', error);
    }
};

const initiateCall = async (targetClient) => {
    isCallActive = true;
    updateClientStatus(targetClient.id, 'CALLED');

    try {
        logger.info(`Initiating call to ${targetClient.name} (${targetClient.phone})`);

        const streamUrl = `wss://${config.server.publicUrl.replace('https://', '')}/voice/stream`;

        const twiml = `
<Response>
    <Connect>
        <Stream url="${streamUrl}">
            <Parameter name="callerId" value="${targetClient.phone}" />
            <Parameter name="mode" value="outbound" />
        </Stream>
    </Connect>
</Response>
        `;

        await client.calls.create({
            twiml: twiml,
            to: targetClient.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
        });

    } catch (error) {
        logger.error('Error initiating call:', error);
        isCallActive = false; // Release lock on error
    }
};
