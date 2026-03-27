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

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;
const clientsFilePath = path.join(process.cwd(), 'src', 'data', 'clients.json');

const getClients = () => {
    try {
        if (!fs.existsSync(clientsFilePath)) return [];
        const data = fs.readFileSync(clientsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return [];
    }
};

const saveClients = (clients) => {
    try {
        fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
    } catch (error) {
        logger.error('Error writing clients.json:', error);
    }
};

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');

    const morningStart = denverTime.hour(9).minute(30).second(0);
    const morningEnd = denverTime.hour(11).minute(30).second(0);

    const afternoonStart = denverTime.hour(14).minute(30).second(0);
    const afternoonEnd = denverTime.hour(15).minute(30).second(0);

    return denverTime.isBetween(morningStart, morningEnd) || denverTime.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
    logger.info('Starting Smart Drip Engine...');
    dripInterval = setInterval(async () => {
        if (isCallActive) {
            return;
        }

        if (!isWithinOperatingHours()) {
            return;
        }

        const clients = getClients();
        const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

        if (nextClientIndex === -1) {
            return;
        }

        const nextClient = clients[nextClientIndex];
        logger.info(`Initiating call to pending client: ${nextClient.phone}`);
        isCallActive = true;

        try {
            const client = twilio(config.twilio.accountSid, config.twilio.authToken);
            const publicUrl = config.server.publicUrl;

            // Encode parameters correctly without URL in the API call for TwiML inline conflicts
            const twimlStreamUrl = `wss://${publicUrl.replace(/^https?:\/\//, '')}/voice/stream?mode=outbound&callerId=${encodeURIComponent(nextClient.phone)}`;
            const twiml = `
                <Response>
                    <Connect>
                        <Stream url="${twimlStreamUrl}" />
                    </Connect>
                </Response>
            `;

            const call = await client.calls.create({
                twiml: twiml,
                to: nextClient.phone,
                from: config.twilio.phoneNumber,
                statusCallback: `${publicUrl}/voice/status-callback`,
                statusCallbackMethod: 'POST'
            });

            activeCallSid = call.sid;
            logger.info(`Call initiated. CallSid: ${call.sid}`);

            // Mark as CALLED immediately after successfully initiating the API call
            clients[nextClientIndex].status = 'CALLED';
            saveClients(clients);

        } catch (error) {
            logger.error(`Failed to initiate call to ${nextClient.phone}:`, error);
            isCallActive = false; // Reset lock on error
            activeCallSid = null;
        }

    }, 15000); // Check every 15 seconds
};

export const markCallEnded = (callSid) => {
    if (callSid === activeCallSid) {
        logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped.');
    }
};
