import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../../clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkTimeWindow = () => {
    const now = dayjs().tz('America/Denver');
    const morningStart = now.hour(9).minute(30).second(0);
    const morningEnd = now.hour(11).minute(30).second(0);
    const afternoonStart = now.hour(14).minute(30).second(0); // 2:30 PM
    const afternoonEnd = now.hour(15).minute(30).second(0);   // 3:30 PM

    const isMorning = now.isBetween(morningStart, morningEnd);
    const isAfternoon = now.isBetween(afternoonStart, afternoonEnd);

    return isMorning || isAfternoon;
};

export const markCallEnded = async (callSid) => {
    if (callSid === activeCallSid) {
        logger.info(`Outbound call ended. Releasing lock. (Sid: ${callSid})`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const initiateOutboundCall = async (clientData) => {
    try {
        const client = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Ensure callerId is set so the bot knows the outbound number
        // mode is OUTBOUND
        const twiml = `
            <Response>
                <Connect>
                    <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
                        <Parameter name="callerId" value="${clientData.phone}" />
                        <Parameter name="mode" value="OUTBOUND" />
                    </Stream>
                </Connect>
            </Response>
        `;

        const call = await client.calls.create({
            twiml: twiml,
            to: clientData.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
            statusCallbackEvent: ['completed', 'busy', 'failed', 'no-answer', 'canceled']
        });

        logger.info(`Outbound call initiated to ${clientData.phone}. CallSid: ${call.sid}`);
        isCallActive = true;
        activeCallSid = call.sid;

    } catch (error) {
        logger.error(`Error initiating outbound call to ${clientData.phone}:`, error);
        isCallActive = false;
        activeCallSid = null;
    }
};

const processNextClient = async () => {
    if (isCallActive) {
        return; // Wait for active call to finish
    }

    if (!checkTimeWindow()) {
        return; // Outside of allowed MT windows
    }

    try {
        if (!fs.existsSync(CLIENTS_FILE)) {
            return;
        }

        let clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));

        const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

        if (nextClientIndex !== -1) {
            const nextClient = clients[nextClientIndex];

            // Mark as CALLED immediately
            clients[nextClientIndex].status = 'CALLED';
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

            logger.info(`Processing next client: ${nextClient.phone}`);

            // Initiate call
            await initiateOutboundCall(nextClient);
        }
    } catch (error) {
        logger.error('Error in processNextClient:', error);
    }
};

export const startDrip = () => {
    logger.info('Starting Smart Drip engine...');
    // Run every 15 seconds to check if we should call next
    dripInterval = setInterval(processNextClient, 15000);
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip engine stopped.');
    }
};
