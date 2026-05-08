import fs from 'fs/promises';
import path from 'path';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');
const POLLING_INTERVAL_MS = 15000;

export const startDrip = () => {
    if (dripInterval) {
        logger.warn('Drip is already running.');
        return;
    }
    logger.info('Starting Smart Drip Engine...');
    dripInterval = setInterval(processNextClient, POLLING_INTERVAL_MS);
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
        logger.info(`Releasing lock for callSid: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const timeFormat = 'HH:mm';
    const currentTime = now.format(timeFormat);

    // 9:30-11:30 or 14:30-15:30
    const isMorning = now.isBetween(
        dayjs().tz('America/Denver').hour(9).minute(30).second(0),
        dayjs().tz('America/Denver').hour(11).minute(30).second(0),
        'minute', '[]'
    );
    const isAfternoon = now.isBetween(
        dayjs().tz('America/Denver').hour(14).minute(30).second(0),
        dayjs().tz('America/Denver').hour(15).minute(30).second(0),
        'minute', '[]'
    );

    return isMorning || isAfternoon;
};

const processNextClient = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        return; // wait instead of stopDrip to keep cron polling
    }

    let clients = [];
    try {
        const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
        clients = JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.warn('clients.json not found. Drip waiting.');
        } else {
            logger.error('Error reading clients.json:', error);
        }
        return;
    }

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        return; // no pending clients, just wait
    }

    const client = clients[nextClientIndex];

    // Lock before making the call
    isCallActive = true;

    try {
        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        const call = await twilioClient.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            twiml: `
                <Response>
                    <Connect>
                        <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
                            <Parameter name="callerId" value="${client.phone}" />
                            <Parameter name="mode" value="outbound" />
                        </Stream>
                    </Connect>
                </Response>
            `,
            statusCallback: `https://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/inbound/status`,
        });

        activeCallSid = call.sid;
        logger.info(`Initiated outbound call to ${client.phone}, CallSid: ${call.sid}`);

        // Update status only after successful API call
        clients[nextClientIndex].status = 'CALLED';
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf-8');

    } catch (error) {
        logger.error('Error initiating outbound call:', error);
        isCallActive = false; // release lock on error
    }
};
