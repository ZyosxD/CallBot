import fs from 'fs/promises';
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

const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

// Ensure twilio client is created lazily or if config exists
const getTwilioClient = () => {
    return twilio(config.twilio.accountSid, config.twilio.authToken);
};

export const isWithinOperatingHours = () => {
    const nowDenver = dayjs().tz('America/Denver');
    const timeFormat = 'HH:mm';
    const currentTime = nowDenver.format(timeFormat);

    // Check morning window: 9:30-11:30
    const isMorning = nowDenver.isBetween(
        dayjs().tz('America/Denver').hour(9).minute(30),
        dayjs().tz('America/Denver').hour(11).minute(30),
        null,
        '[]' // inclusive
    );

    // Check afternoon window: 14:30-15:30 (2:30 PM - 3:30 PM)
    const isAfternoon = nowDenver.isBetween(
        dayjs().tz('America/Denver').hour(14).minute(30),
        dayjs().tz('America/Denver').hour(15).minute(30),
        null,
        '[]'
    );

    return isMorning || isAfternoon;
};

export const startDrip = () => {
    if (dripInterval) {
        logger.warn('Smart Drip engine is already running.');
        return;
    }

    logger.info('Starting Smart Drip engine...');

    dripInterval = setInterval(async () => {
        if (!isWithinOperatingHours()) {
            // It returns and waits instead of calling stopDrip() during off-hours
            return;
        }

        if (isCallActive) {
            return; // Wait for the active call to finish
        }

        try {
            const data = await fs.readFile(CLIENTS_FILE, 'utf8');
            let clients = JSON.parse(data);

            const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

            if (nextClientIndex === -1) {
                return; // List is empty or all called, wait
            }

            const client = clients[nextClientIndex];
            logger.info(`Found pending client: ${client.phone}. Initiating call...`);

            isCallActive = true;

            const clientPhone = client.phone; // Passed as callerId to TwiML

            // Construct Twiml inline
            const host = config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : 'localhost:3000';
            const protocol = config.server.publicUrl && config.server.publicUrl.startsWith('https') ? 'wss' : 'ws';

            const twilioClient = getTwilioClient();

            const call = await twilioClient.calls.create({
                to: client.phone,
                from: config.twilio.phoneNumber,
                twiml: `
                    <Response>
                        <Connect>
                            <Stream url="${protocol}://${host}/voice/stream">
                                <Parameter name="callerId" value="${clientPhone}" />
                                <Parameter name="mode" value="outbound" />
                            </Stream>
                        </Connect>
                    </Response>
                `,
                statusCallback: `https://${host}/voice/inbound/status`
            });

            activeCallSid = call.sid;
            logger.info(`Call initiated for ${client.phone}, SID: ${call.sid}`);

            // Mark as called immediately after successfully initiating API call
            clients[nextClientIndex].status = 'CALLED';
            await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf8');

        } catch (error) {
            logger.error('Error in Smart Drip loop:', error);
            isCallActive = false;
            activeCallSid = null;
        }
    }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip engine stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Call ended matching active outbound SID: ${callSid}. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};
