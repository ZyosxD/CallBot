import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');

    const morningStart = now.hour(9).minute(30).second(0);
    const morningEnd = now.hour(11).minute(30).second(0);

    const afternoonStart = now.hour(14).minute(30).second(0);
    const afternoonEnd = now.hour(15).minute(30).second(0);

    return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
    logger.info('Starting Drip Campaign checker...');
    if (dripInterval) clearInterval(dripInterval);

    dripInterval = setInterval(async () => {
        if (isCallActive) {
            return;
        }

        if (!isWithinOperatingHours()) {
            return;
        }

        try {
            let clients = [];
            if (fs.existsSync(clientsFilePath)) {
                clients = JSON.parse(fs.readFileSync(clientsFilePath, 'utf8'));
            }

            const clientIndex = clients.findIndex(c => c.status === 'PENDING');
            if (clientIndex === -1) {
                return;
            }

            const client = clients[clientIndex];

            // Initiate call
            isCallActive = true;
            logger.info(`Initiating outbound call to ${client.phone} (${client.name})...`);

            const call = await twilioClient.calls.create({
                to: client.phone,
                from: config.twilio.phoneNumber,
                twiml: `<Response><Connect><Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream"><Parameter name="mode" value="outbound" /><Parameter name="callerId" value="${client.phone}" /></Stream></Connect></Response>`,
                statusCallback: `${config.server.publicUrl}/voice/inbound/status`
            });

            activeCallSid = call.sid;
            logger.info(`Call initiated. Sid: ${activeCallSid}`);

            // Mark as called
            clients[clientIndex].status = 'CALLED';
            fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));

        } catch (error) {
            logger.error('Error in Drip Campaign step', error);
            isCallActive = false;
            activeCallSid = null;
        }

    }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};
