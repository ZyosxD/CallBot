import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
export let isCallActive = false;
export let activeCallSid = null;

const isWithinOperatingHours = () => {
    const nowDenver = dayjs().tz('America/Denver');
    const timeNum = nowDenver.hour() * 100 + nowDenver.minute();
    // 9:30 AM = 930, 11:30 AM = 1130
    // 2:30 PM = 1430, 3:30 PM = 1530
    if (timeNum >= 930 && timeNum <= 1130) return true;
    if (timeNum >= 1430 && timeNum <= 1530) return true;
    return false;
};

const processNextCall = async () => {
    if (isCallActive) return;
    if (!isWithinOperatingHours()) return; // return and wait, don't stop cron

    let clients = [];
    try {
        if (fs.existsSync(clientsPath)) {
            clients = JSON.parse(fs.readFileSync(clientsPath, 'utf-8'));
        }
    } catch (e) {
        logger.error('Error reading clients.json:', e);
        return;
    }

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
    if (nextClientIndex === -1) return; // return and wait if no more clients

    const client = clients[nextClientIndex];
    isCallActive = true;

    try {
        const clientPhone = client.phone;
        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        logger.info(`Initiating outbound call to ${clientPhone}`);

        // Construct the TwiML inline so we don't need a separate endpoint for outbound TwiML
        const protocol = config.server.publicUrl && config.server.publicUrl.startsWith('https') ? 'wss' : 'ws';
        const host = config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : 'localhost:3000';

        const streamUrl = `${protocol}://${host}/voice/stream`;

        const twiml = `
            <Response>
                <Connect>
                    <Stream url="${streamUrl}">
                        <Parameter name="callerId" value="${clientPhone}" />
                        <Parameter name="mode" value="outbound" />
                    </Stream>
                </Connect>
            </Response>
        `;

        const statusCallbackUrl = config.server.publicUrl ? `${config.server.publicUrl}/voice/inbound/status` : null;

        const callParams = {
            to: clientPhone,
            from: config.twilio.phoneNumber,
            twiml: twiml
        };

        if (statusCallbackUrl) {
            callParams.statusCallback = statusCallbackUrl;
            // Omit statusCallbackEvent to receive all terminal states
        }

        const call = await twilioClient.calls.create(callParams);

        activeCallSid = call.sid;
        logger.info(`Call initiated. SID: ${activeCallSid}`);

        // Mark as CALLED immediately after initiating call to prevent duplicates
        clients[nextClientIndex].status = 'CALLED';
        fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

    } catch (error) {
        logger.error('Error initiating outbound call:', error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid && activeCallSid === callSid) {
        logger.info(`Outbound call ended. Releasing lock. SID: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    } else {
        logger.info(`Call ended, but lock was not held by this SID. Expected: ${activeCallSid}, Got: ${callSid}`);
    }
};

export const startDrip = () => {
    if (dripInterval) return;
    logger.info('Starting Smart Drip campaign...');
    // check every 30 seconds
    dripInterval = setInterval(processNextCall, 30000);
    // fire once immediately
    processNextCall();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip campaign stopped.');
    }
};
