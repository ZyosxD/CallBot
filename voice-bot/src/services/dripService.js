import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { getClients, updateClientStatus } from './dataService.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');

    // Morning: 9:30 AM - 11:30 AM
    const morningStart = denverTime.hour(9).minute(30).second(0);
    const morningEnd = denverTime.hour(11).minute(30).second(0);

    // Afternoon: 2:30 PM - 3:30 PM
    const afternoonStart = denverTime.hour(14).minute(30).second(0);
    const afternoonEnd = denverTime.hour(15).minute(30).second(0);

    return denverTime.isBetween(morningStart, morningEnd) || denverTime.isBetween(afternoonStart, afternoonEnd);
};

const executeNextCall = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside of operating hours (Mountain Time). Waiting...');
        return;
    }

    const clients = await getClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
        logger.info('No pending clients left to call. Waiting...');
        return;
    }

    const client = clients[nextClientIndex];
    isCallActive = true;

    try {
        logger.info(`Initiating call to ${client.phone} (${client.name})`);

        // IMPORTANT: We mark as CALLED immediately before calling, to prevent duplicates.
        await updateClientStatus(client.phone, 'CALLED');

        // Pass callerId (client.phone) via URL param so TwiML can pick it up
        const serverUrl = config.server.publicUrl || `http://localhost:${config.server.port}`;

        const call = await twilioClient.calls.create({
            twiml: `<Response><Connect><Stream url="wss://${serverUrl.replace(/^https?:\/\//, '')}/voice/stream"><Parameter name="callerId" value="${client.phone}" /><Parameter name="mode" value="outbound" /></Stream></Connect></Response>`,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${serverUrl}/voice/inbound/status`
            // Not restricting statusCallbackEvent to allow all events to trigger status route
        });

        activeCallSid = call.sid;
        logger.info(`Outbound call created: ${activeCallSid}`);
    } catch (error) {
        logger.error(`Failed to create call to ${client.phone}:`, error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) {
        return;
    }
    logger.info('Starting Smart Drip service...');
    // Poll every 15 seconds
    dripInterval = setInterval(executeNextCall, 15000);
    // Execute immediately once
    executeNextCall();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip service stopped.');
    }
};

export const markCallEnded = async (callSid) => {
    // Only release lock if the ending call is the outbound call we're tracking
    if (activeCallSid === callSid || !activeCallSid) {
        logger.info(`Releasing concurrency lock for call ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};
