import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import cron from 'node-cron';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsFile = path.resolve('src/data/clients.json');

let isCallActive = false;
export let activeCallSid = null;
let dripTask = null;

const getTwilioClient = () => {
    return twilio(config.twilio.accountSid, config.twilio.authToken);
};

const isWithinOperatingHours = () => {
    const nowDenver = dayjs().tz('America/Denver');
    const time = nowDenver.format('HH:mm');

    const isMorning = time >= '09:30' && time <= '11:30';
    const isAfternoon = time >= '14:30' && time <= '15:30';

    return isMorning || isAfternoon;
};

const loadClients = () => {
    if (!fs.existsSync(clientsFile)) return [];
    try {
        const data = fs.readFileSync(clientsFile, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return [];
    }
};

const saveClients = (clients) => {
    try {
        fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2), 'utf-8');
    } catch (error) {
        logger.error('Error writing to clients.json:', error);
    }
};

const processNextClient = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        return;
    }

    const clients = loadClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        return; // No more clients
    }

    isCallActive = true;
    const client = clients[nextClientIndex];
    logger.info(`Starting outbound call to ${client.phone} (${client.name || 'Unknown'})`);

    try {
        const twilioClient = getTwilioClient();

        // Mark as CALLED immediately after successfully initiating the API call
        const call = await twilioClient.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            twiml: `<Response><Connect><Stream url="wss://${config.server.publicUrl}/voice/stream"><Parameter name="mode" value="outbound" /><Parameter name="callerId" value="${client.phone}" /></Stream></Connect></Response>`,
            statusCallback: `https://${config.server.publicUrl}/voice/inbound/status`
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated. SID: ${activeCallSid}`);

        clients[nextClientIndex].status = 'CALLED';
        saveClients(clients);

    } catch (error) {
        logger.error('Error initiating outbound call:', error);
        isCallActive = false; // release lock on error
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripTask) return;
    logger.info('Starting Smart Drip service');

    // Check every 10 seconds
    dripTask = cron.schedule('*/10 * * * * *', () => {
        processNextClient();
    });
};

export const stopDrip = () => {
    if (dripTask) {
        logger.info('Stopping Smart Drip service');
        dripTask.stop();
        dripTask = null;
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};
