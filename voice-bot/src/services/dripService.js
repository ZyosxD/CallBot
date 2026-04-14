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

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const ensureFileExists = () => {
    if (!fs.existsSync(CLIENTS_FILE)) {
        const dir = path.dirname(CLIENTS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify([]));
    }
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const time = now.format('HH:mm');

    const isMorning = time >= '09:30' && time <= '11:30';
    const isAfternoon = time >= '14:30' && time <= '15:30';

    return isMorning || isAfternoon;
};

export const startDrip = () => {
    logger.info('Starting Smart Drip Engine...');
    ensureFileExists();

    if (dripInterval) clearInterval(dripInterval);

    dripInterval = setInterval(async () => {
        if (!isWithinOperatingHours()) {
            // Out of hours, just wait
            return;
        }

        if (isCallActive) {
            // Already calling
            return;
        }

        try {
            const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
            const clients = JSON.parse(data);

            const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

            if (pendingClientIndex === -1) {
                // No pending clients
                return;
            }

            // Mark as active
            isCallActive = true;
            const client = clients[pendingClientIndex];

            // Setup TwiML
            const twiml = new twilio.twiml.VoiceResponse();
            const connect = twiml.connect();
            const stream = connect.stream({
                url: `${config.server.publicUrl.replace(/^http/, 'ws')}/voice/stream`
            });
            stream.parameter({ name: 'callerId', value: client.phone });
            stream.parameter({ name: 'mode', value: 'outbound' });

            // Mark called immediately to prevent duplicate dials
            clients[pendingClientIndex].status = 'CALLED';
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

            // Initiate call
            logger.info(`Initiating outbound call to ${client.phone} (${client.name})`);
            const call = await twilioClient.calls.create({
                twiml: twiml.toString(),
                to: client.phone,
                from: config.twilio.phoneNumber,
                statusCallback: `${config.server.publicUrl}/voice/inbound/status`
                // No statusCallbackEvent array, defaults to completed
            });

            activeCallSid = call.sid;
            logger.info(`Outbound call initiated. CallSid: ${activeCallSid}`);

        } catch (error) {
            logger.error('Error in Smart Drip Engine:', error);
            // Release lock if failed
            isCallActive = false;
            activeCallSid = null;
        }

    }, 10000); // Check every 10 seconds
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
        logger.info(`Call ended lock released for ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
