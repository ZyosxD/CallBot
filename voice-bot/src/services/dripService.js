import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const CLIENTS_FILE = path.resolve(process.cwd(), 'src/data/clients.json');
const TIMEZONE = 'America/Denver';

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
    logger.info('Starting Smart Drip Campaign engine...');
    // Run every 30 seconds
    dripInterval = setInterval(checkAndCall, 30000);
    // Execute immediately on start
    checkAndCall();
};

export const stopDrip = () => {
    logger.info('Stopping Smart Drip Campaign engine...');
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Outbound call ${callSid} finished. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz(TIMEZONE);

    const morningStart = now.hour(9).minute(30).second(0);
    const morningEnd = now.hour(11).minute(30).second(0);

    const afternoonStart = now.hour(14).minute(30).second(0);
    const afternoonEnd = now.hour(15).minute(30).second(0);

    return now.isBetween(morningStart, morningEnd, null, '[]') ||
           now.isBetween(afternoonStart, afternoonEnd, null, '[]');
};

const checkAndCall = async () => {
    if (isCallActive) {
        logger.info('A call is currently active. Waiting...');
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside of operating hours (MT: 9:30-11:30 & 14:30-15:30). Waiting...');
        return;
    }

    let clients = [];
    try {
        if (!fs.existsSync(CLIENTS_FILE)) {
            logger.warn('clients.json not found, unable to run drip campaign.');
            return;
        }
        clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'));
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return;
    }

    // Find first pending client
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        logger.info('No PENDING clients left in clients.json. Waiting...');
        return;
    }

    const client = clients[nextClientIndex];
    logger.info(`Initiating outbound call to ${client.phone} (${client.name})...`);

    // Lock the drip engine
    isCallActive = true;

    try {
        // Construct stream URL and encode callerId in the query so callController can extract it,
        // though we actually pass callerId inline in the TwiML stream parameter for simplicity here.
        // We will pass the twiml directly to Twilio

        const host = new URL(config.server.publicUrl).host;
        const twiml = `
            <Response>
                <Connect>
                    <Stream url="wss://${host}/voice/stream">
                        <Parameter name="mode" value="outbound" />
                        <Parameter name="callerId" value="${client.phone}" />
                    </Stream>
                </Connect>
            </Response>
        `;

        const call = await twilioClient.calls.create({
            twiml: twiml,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/statusCallback`,
            statusCallbackEvent: ['completed'],
        });

        logger.info(`Call initiated! SID: ${call.sid}`);
        activeCallSid = call.sid;

        // Mark as CALLED immediately
        clients[nextClientIndex].status = 'CALLED';
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    } catch (error) {
        logger.error(`Error creating Twilio call to ${client.phone}:`, error);
        // Release lock on error
        isCallActive = false;
        activeCallSid = null;
    }
};
