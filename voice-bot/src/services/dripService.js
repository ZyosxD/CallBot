import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let intervalId = null;
export let isCallActive = false;
export let activeCallSid = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Unlocking drip service for callSid: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');
    const timeNum = denverTime.hour() * 100 + denverTime.minute();

    // Morning: 9:30 AM - 11:30 AM
    const isMorning = timeNum >= 930 && timeNum <= 1130;
    // Afternoon: 2:30 PM - 3:30 PM (14:30 - 15:30)
    const isAfternoon = timeNum >= 1430 && timeNum <= 1530;

    return isMorning || isAfternoon;
};

const processNextCall = async () => {
    if (isCallActive) return;

    if (!isWithinOperatingHours()) {
        return;
    }

    try {
        if (!fs.existsSync(clientsFilePath)) {
            return;
        }

        const data = fs.readFileSync(clientsFilePath, 'utf8');
        const clients = JSON.parse(data);

        const nextClientIndex = clients.findIndex(c => c.status === "PENDING");

        if (nextClientIndex === -1) {
            return;
        }

        const nextClient = clients[nextClientIndex];

        logger.info(`Initiating Smart Drip call to ${nextClient.name} (${nextClient.phone})`);

        isCallActive = true;

        const twiml = `
        <Response>
            <Connect>
                <Stream url="wss://${config.server.publicUrl ? new URL(config.server.publicUrl).host : 'localhost'}/voice/stream">
                    <Parameter name="mode" value="outbound" />
                </Stream>
            </Connect>
        </Response>
        `;

        const call = await client.calls.create({
            twiml: twiml,
            to: nextClient.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl || 'http://localhost'}/voice/inbound/status`,
            statusCallbackMethod: 'POST'
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated. SID: ${call.sid}`);

        clients[nextClientIndex].status = "CALLED";
        fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));

    } catch (error) {
        logger.error(`Error in Smart Drip process: ${error.message}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (intervalId) return;
    logger.info("Starting Smart Drip Engine polling...");
    intervalId = setInterval(processNextCall, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        logger.info("Smart Drip Engine stopped.");
    }
};
