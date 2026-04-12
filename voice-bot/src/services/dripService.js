import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');
let dripInterval = null;
let isCallActive = false;
export let activeCallSid = null;

export function isWithinOperatingHours() {
    const now = dayjs().tz('America/Denver');
    const timeNum = now.hour() * 100 + now.minute();
    const isMorning = timeNum >= 930 && timeNum < 1130;
    const isAfternoon = timeNum >= 1430 && timeNum < 1530;
    return isMorning || isAfternoon;
}

export function startDrip() {
    if (dripInterval) return;
    logger.info('Smart Drip engine started.');

    dripInterval = setInterval(async () => {
        if (!isWithinOperatingHours()) {
            logger.info('Outside operating hours. Pausing drip...');
            return;
        }

        if (isCallActive) {
            return;
        }

        let clients = [];
        try {
            if (fs.existsSync(CLIENTS_FILE)) {
                clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
            }
        } catch (err) {
            logger.error('Error reading clients file:', err);
            return;
        }

        const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
        if (nextClientIndex === -1) {
            logger.info('No pending clients left in queue.');
            return;
        }

        const client = clients[nextClientIndex];

        try {
            isCallActive = true;
            logger.info(`Initiating call to ${client.phone}`);

            const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

            // Mark CALLED exactly before initiating to prevent loops if twilio hangs
            clients[nextClientIndex].status = 'CALLED';
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

            let publicUrl = config.server.publicUrl;
            if (!publicUrl) {
                logger.warn('PUBLIC_URL not set in config, outbound call TwiML url might fail.');
                publicUrl = 'http://localhost:' + config.server.port;
            }

            const call = await clientTwilio.calls.create({
                url: `${publicUrl}/voice/outbound?callerId=${encodeURIComponent(client.phone)}`,
                to: client.phone,
                from: config.twilio.phoneNumber,
                statusCallback: `${publicUrl}/voice/inbound/status`,
            });

            activeCallSid = call.sid;
            logger.info(`Call initiated. CallSid: ${call.sid}`);

        } catch (error) {
            logger.error(`Error placing call to ${client.phone}:`, error);
            isCallActive = false;
            activeCallSid = null;
        }

    }, 15000); // Check every 15 seconds
}

export function stopDrip() {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip engine stopped.');
    }
}

export function markCallEnded(callSid) {
    if (activeCallSid && activeCallSid === callSid) {
        logger.info(`Releasing lock for ended outbound call: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
}
