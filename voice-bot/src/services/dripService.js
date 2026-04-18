import fs from 'fs/promises';
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
const TIMEZONE = 'America/Denver';

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const getTwilioClient = () => {
    return twilio(config.twilio.accountSid, config.twilio.authToken);
};

export const isWithinOperatingHours = () => {
    const now = dayjs().tz(TIMEZONE);
    const hour = now.hour();
    const minute = now.minute();
    const timeInMinutes = hour * 60 + minute;

    // Morning: 9:30 AM (570) to 11:30 AM (690)
    const isMorning = timeInMinutes >= 570 && timeInMinutes < 690;

    // Afternoon: 2:30 PM (870) to 3:30 PM (930)
    const isAfternoon = timeInMinutes >= 870 && timeInMinutes < 930;

    return isMorning || isAfternoon;
};

export const startDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
    }

    logger.info('Starting Smart Drip Engine');

    // Poll every 10 seconds
    dripInterval = setInterval(pollDrip, 10000);
    // Run an initial poll
    pollDrip();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip Engine stopped');
    }
};

const pollDrip = async () => {
    try {
        if (!isWithinOperatingHours()) {
            return; // Wait for the next poll
        }

        if (isCallActive) {
            return; // Wait for active call to end
        }

        const clientsData = await fs.readFile(CLIENTS_FILE, 'utf-8');
        let clients = JSON.parse(clientsData);

        const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

        if (nextClientIndex === -1) {
            return; // Wait for new clients
        }

        const client = clients[nextClientIndex];

        logger.info(`Initiating outbound call to ${client.phone} (${client.name})`);

        // Lock
        isCallActive = true;

        // Mark as called immediately before Twilio call to prevent duplicates
        clients[nextClientIndex].status = 'CALLED';
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

        const publicUrl = config.server.publicUrl;
        // Build TwiML with the Stream that provides parameters for mode and callerId
        const twiml = `
            <Response>
                <Connect>
                    <Stream url="wss://${new URL(publicUrl).host}/voice/stream">
                        <Parameter name="mode" value="outbound" />
                        <Parameter name="callerId" value="${client.phone}" />
                    </Stream>
                </Connect>
            </Response>
        `;

        const twilioClient = getTwilioClient();
        const call = await twilioClient.calls.create({
            twiml: twiml,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${publicUrl}/voice/inbound/status`
        });

        activeCallSid = call.sid;
        logger.info(`Outbound call initiated. CallSid: ${call.sid}`);

    } catch (error) {
        logger.error('Error in Drip Polling:', error);
        // Release lock on error
        isCallActive = false;
        activeCallSid = null;
    }
};

export const markCallEnded = async (callSid) => {
    // Only release lock if the ending call is the currently active outbound call
    if (callSid === activeCallSid || (callSid && !activeCallSid)) {
        logger.info(`Releasing lock for call ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};