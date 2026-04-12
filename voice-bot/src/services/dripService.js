import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
export let activeCallSid = null;

// Ensure clients.json exists
const ensureDataFiles = () => {
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(clientsPath)) {
      fs.writeFileSync(clientsPath, JSON.stringify([], null, 2));
  }
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const timeStr = now.format('HH:mm');

    // 9:30-11:30 or 14:30-15:30
    const inMorning = timeStr >= '09:30' && timeStr <= '11:30';
    const inAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

    return inMorning || inAfternoon;
};

const getNextPendingClient = () => {
    ensureDataFiles();
    const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
    const index = clients.findIndex(c => c.status === 'PENDING');

    if (index !== -1) {
        // Mark as CALLED immediately to avoid data loss
        const client = clients[index];
        clients[index].status = 'CALLED';
        fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
        return client;
    }
    return null;
};

const makeCall = async (client) => {
    try {
        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Mode passed as stream parameter from webhook body parameter 'Direction' doesn't work for initial TwiML.
        // We will just let inbound webhook detect it via Direction.
        // The URL needs callerId as well.
        const baseUrl = config.server.publicUrl;
        const twimlUrl = `${baseUrl}/voice/inbound?callerId=${encodeURIComponent(client.phone)}`;

        const call = await twilioClient.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            url: twimlUrl,
            statusCallback: `${baseUrl}/voice/inbound/status`,
            machineDetection: 'Enable',
            asyncAmd: 'true'
        });

        activeCallSid = call.sid;
        logger.info(`Initiated outbound call to ${client.phone}, CallSid: ${activeCallSid}`);
    } catch (error) {
        logger.error(`Failed to make outbound call to ${client.phone}:`, error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const processDripQueue = async () => {
    if (isCallActive) {
        return; // Wait for the current call to finish
    }

    if (!isWithinOperatingHours()) {
        return; // Outside operating hours, just wait
    }

    const client = getNextPendingClient();
    if (client) {
        isCallActive = true;
        await makeCall(client);
    }
};

export const startDrip = () => {
    logger.info('Starting Smart Drip Engine...');
    ensureDataFiles();
    if (!dripInterval) {
        dripInterval = setInterval(processDripQueue, 5000); // Poll every 5 seconds
    }
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid && callSid === activeCallSid) {
        logger.info(`Call ${callSid} ended, releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};
