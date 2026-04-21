import fs from 'fs/promises';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const time = now.format('HH:mm');
    return (time >= '09:30' && time <= '11:30') || (time >= '14:30' && time <= '15:30');
};

const getNextPendingClient = async () => {
    try {
        const data = await fs.readFile(CLIENTS_FILE, 'utf8');
        const clients = JSON.parse(data);
        const index = clients.findIndex(c => c.status === 'PENDING');
        if (index !== -1) {
            return { client: clients[index], index, clients };
        }
    } catch (error) {
        logger.error('Error reading clients.json:', error);
    }
    return null;
};

const markClientCalled = async (clients, index) => {
    try {
        clients[index].status = 'CALLED';
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf8');
    } catch (error) {
        logger.error('Error writing to clients.json:', error);
    }
};

const processNextCall = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        return;
    }

    const result = await getNextPendingClient();
    if (!result) {
        return;
    }

    const { client, index, clients } = result;

    isCallActive = true;

    try {
        const publicUrl = config.server.publicUrl;

        // Pass callerId to the TwiML endpoint for outbound calls
        const twimlUrl = `${publicUrl}/voice/outbound?callerId=${encodeURIComponent(client.phone)}`;

        const call = await twilioClient.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            url: twimlUrl,
            statusCallback: `${publicUrl}/voice/status`,
            statusCallbackMethod: 'POST'
        });

        activeCallSid = call.sid;
        logger.info(`Started outbound call to ${client.phone}, CallSid: ${call.sid}`);

        await markClientCalled(clients, index);

    } catch (error) {
        logger.error(`Error making outbound call to ${client.phone}:`, error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
    }
    // Poll every 30 seconds
    dripInterval = setInterval(processNextCall, 30000);
    logger.info('Smart Drip Engine started.');
    // Run immediately
    processNextCall();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};
