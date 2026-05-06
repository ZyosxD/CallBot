import cron from 'node-cron';
import twilio from 'twilio';
import fs from 'fs/promises';
import path from 'path';
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

let isCallActive = false;
let activeCallSid = null;
let cronJob = null;

const checkOperatingHours = () => {
    const nowDenver = dayjs().tz('America/Denver');

    const morningStart = dayjs.tz(`${nowDenver.format('YYYY-MM-DD')} 09:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');
    const morningEnd = dayjs.tz(`${nowDenver.format('YYYY-MM-DD')} 11:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');

    const afternoonStart = dayjs.tz(`${nowDenver.format('YYYY-MM-DD')} 14:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');
    const afternoonEnd = dayjs.tz(`${nowDenver.format('YYYY-MM-DD')} 15:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');

    return nowDenver.isBetween(morningStart, morningEnd) || nowDenver.isBetween(afternoonStart, afternoonEnd);
};

const executeDrip = async () => {
    if (isCallActive) {
        logger.info('Call is currently active. Waiting...');
        return;
    }

    if (!checkOperatingHours()) {
        logger.info('Outside of operating hours (MT 9:30-11:30 or 14:30-15:30). Waiting...');
        return;
    }

    try {
        const clientsPath = path.resolve('src/data/clients.json');
        let clients = [];
        try {
             clients = JSON.parse(await fs.readFile(clientsPath, 'utf8'));
        } catch (err) {
             logger.error('Failed to read clients.json', err);
             return;
        }

        const pendingIndex = clients.findIndex(c => c.status === 'PENDING');
        if (pendingIndex === -1) {
            logger.info('No pending clients found. Waiting...');
            return;
        }

        const client = clients[pendingIndex];

        logger.info(`Initiating outbound call to ${client.phone}`);
        isCallActive = true;

        const clientRest = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Pass the client phone as callerId to match memory rule
        const urlParams = new URLSearchParams({
            Direction: 'outbound-api',
            To: client.phone
        });

        const call = await clientRest.calls.create({
            url: `${config.server.publicUrl}/voice/inbound`,
            to: client.phone,
            from: config.twilio.phoneNumber,
            // Do not restrict statusCallbackEvent with an array to receive all updates
            statusCallback: `${config.server.publicUrl}/voice/outbound/status`
        });

        activeCallSid = call.sid;
        logger.info(`Outbound call initiated. CallSid: ${activeCallSid}`);

        // Update status immediately after initiating call
        clients[pendingIndex].status = 'CALLED';
        await fs.writeFile(clientsPath, JSON.stringify(clients, null, 2));

    } catch (error) {
        logger.error('Error during Drip execution:', error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (cronJob) return;
    logger.info('Starting Smart Drip Engine...');
    // Run every 10 seconds to constantly poll and execute when conditions are met
    cronJob = cron.schedule('*/10 * * * * *', executeDrip);
};

export const stopDrip = () => {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
        logger.info('Stopped Smart Drip Engine.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid && activeCallSid === callSid) {
        logger.info(`Releasing lock for call ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    } else {
        logger.info(`Call ${callSid} ended, but it was not the active outbound call (${activeCallSid}). Ignoring lock release.`);
    }
};