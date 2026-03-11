import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

export const getClients = () => {
    try {
        if (!fs.existsSync(CLIENTS_FILE)) {
            return [];
        }
        const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return [];
    }
};

export const updateClientStatus = (clientId, status) => {
    try {
        const clients = getClients();
        const clientIndex = clients.findIndex(c => c.id == clientId);
        if (clientIndex !== -1) {
            clients[clientIndex].status = status;
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
            return true;
        }
        return false;
    } catch (error) {
        logger.error(`Error updating client ${clientId} status:`, error);
        return false;
    }
};

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');
    const timeNum = denverTime.hour() * 100 + denverTime.minute();

    // 9:30 AM = 930, 11:30 AM = 1130
    // 2:30 PM = 1430, 3:30 PM = 1530
    const isMorning = timeNum >= 930 && timeNum <= 1130;
    const isAfternoon = timeNum >= 1430 && timeNum <= 1530;

    return isMorning || isAfternoon;
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Releasing lock for call ${callSid}. Bot ready for next call.`);
        isCallActive = false;
        activeCallSid = null;
    } else {
         // Could be an inbound call ending, or a mismatched SID. Ignore.
         logger.info(`Received completion for non-active/inbound call ${callSid}. Ignoring for drip lock.`);
    }
};

export const processNextCall = async () => {
    if (isCallActive) {
        logger.info('Smart Drip: Call currently active. Waiting for it to finish.');
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Smart Drip: Currently outside of operating hours (Denver Time). Waiting.');
        return;
    }

    const clients = getClients();
    const nextClient = clients.find(c => c.status === 'PENDING');

    if (!nextClient) {
        logger.info('Smart Drip: No pending clients found. Checking again later.');
        return;
    }

    try {
        // Lock the queue immediately
        isCallActive = true;

        // Mathematical duplicate prevention
        logger.info(`Smart Drip: Selected client ${nextClient.name} (${nextClient.phone}). Marking as CALLED.`);
        updateClientStatus(nextClient.id, 'CALLED');

        const client = twilio(config.twilio.accountSid, config.twilio.authToken);

        // We use inline TwiML to bypass complex external callbacks for start
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
                <Connect>
                    <Stream url="wss://${config.server.publicUrl.replace('https://', '').replace('http://', '')}/voice/stream">
                        <Parameter name="mode" value="outbound" />
                        <Parameter name="callerId" value="${nextClient.phone}" />
                    </Stream>
                </Connect>
            </Response>`;

        logger.info(`Smart Drip: Dialing ${nextClient.phone}...`);

        const call = await client.calls.create({
            twiml: twiml,
            to: nextClient.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status-callback`,
            statusCallbackEvent: ['completed'],
            statusCallbackMethod: 'POST'
        });

        activeCallSid = call.sid;
        logger.info(`Smart Drip: Call initiated successfully. CallSid: ${call.sid}`);

    } catch (error) {
        logger.error(`Smart Drip: Failed to initiate call for client ${nextClient.id}`, error);
        // On fatal error, release lock and revert status
        isCallActive = false;
        activeCallSid = null;
        updateClientStatus(nextClient.id, 'PENDING');
    }
};

export const startDrip = () => {
    logger.info('Starting Smart Drip Engine...');
    // Process every 10 seconds to allow for completion propagation
    dripInterval = setInterval(processNextCall, 10000);
    processNextCall(); // Initial check
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        logger.info('Smart Drip Engine stopped.');
    }
};
