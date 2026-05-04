import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientsFile = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

// Helper to write to JSON
const writeClients = (data) => {
    fs.writeFileSync(clientsFile, JSON.stringify(data, null, 2));
};

// Helper to read from JSON
const readClients = () => {
    if (!fs.existsSync(clientsFile)) {
        return [];
    }
    const raw = fs.readFileSync(clientsFile, 'utf-8');
    try {
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
};

const isWithinOperatingHours = () => {
    const nowDenver = dayjs().tz('America/Denver');

    const morningStart = nowDenver.clone().hour(9).minute(30).second(0);
    const morningEnd = nowDenver.clone().hour(11).minute(30).second(0);

    const afternoonStart = nowDenver.clone().hour(14).minute(30).second(0);
    const afternoonEnd = nowDenver.clone().hour(15).minute(30).second(0);

    return nowDenver.isBetween(morningStart, morningEnd) || nowDenver.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
    }
    logger.info('Starting Smart Drip Engine...');

    // Check every 15 seconds
    dripInterval = setInterval(processNextCall, 15000);
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped.');
    }
};

export const markCallEnded = (callSid) => {
    // Only release lock if the ending call is our active outbound call
    if (isCallActive && activeCallSid === callSid) {
        logger.info(`Releasing concurrency lock for CallSid: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const processNextCall = async () => {
    if (isCallActive) {
        return; // Wait, call in progress
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside of operating hours (Denver Time). Waiting...');
        return; // Wait for the right time, do not stop cron
    }

    const clients = readClients();
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
        logger.info('No more PENDING clients. Waiting for new ones...');
        return;
    }

    const client = clients[pendingClientIndex];

    try {
        isCallActive = true;
        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        logger.info(`Initiating outbound call to ${client.phone}...`);

        const call = await twilioClient.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            twiml: `
                <Response>
                    <Connect>
                        <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
                            <Parameter name="callerId" value="${client.phone}" />
                            <Parameter name="mode" value="outbound" />
                        </Stream>
                    </Connect>
                </Response>
            `,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`
        });

        activeCallSid = call.sid;
        logger.info(`Outbound call initiated successfully. CallSid: ${call.sid}`);

        // Update status only after successful dial
        clients[pendingClientIndex].status = 'CALLED';
        writeClients(clients);

    } catch (error) {
        logger.error(`Error initiating outbound call to ${client.phone}:`, error);
        isCallActive = false;
        activeCallSid = null;

        // Optionally mark as FAILED instead of looping indefinitely
        clients[pendingClientIndex].status = 'FAILED';
        writeClients(clients);
    }
};
