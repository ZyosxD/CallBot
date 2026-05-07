import fs from 'fs/promises';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');

    const morningStart = dayjs.tz(`${now.format('YYYY-MM-DD')} 09:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');
    const morningEnd = dayjs.tz(`${now.format('YYYY-MM-DD')} 11:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');

    const afternoonStart = dayjs.tz(`${now.format('YYYY-MM-DD')} 14:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');
    const afternoonEnd = dayjs.tz(`${now.format('YYYY-MM-DD')} 15:30`, 'America/Denver');

    return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const getClients = async () => {
    try {
        const data = await fs.readFile(CLIENTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile(CLIENTS_FILE, JSON.stringify([]));
            return [];
        }
        throw error;
    }
};

const saveClients = async (clients) => {
    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
};

const processNextCall = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside operating hours. Waiting...');
        return;
    }

    try {
        const clients = await getClients();
        const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

        if (nextClientIndex === -1) {
            logger.info('No pending clients left in queue.');
            return;
        }

        const client = clients[nextClientIndex];
        logger.info(`Initiating call to ${client.name} (${client.phone})`);

        isCallActive = true;

        // Mark as CALLED immediately
        clients[nextClientIndex].status = 'CALLED';
        await saveClients(clients);

        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        const call = await twilioClient.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            url: `${config.server.publicUrl}/voice/inbound`,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated. Sid: ${activeCallSid}`);

    } catch (error) {
        logger.error('Error processing next call:', error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const markCallEnded = (callSid) => {
    if (callSid === activeCallSid) {
        logger.info(`Call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) return;
    logger.info('Starting Smart Drip Engine...');
    dripInterval = setInterval(processNextCall, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Stopped Smart Drip Engine.');
    }
};
