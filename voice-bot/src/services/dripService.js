import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsPath = path.join(process.cwd(), 'src', 'data', 'clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const getClients = () => {
    try {
        const data = fs.readFileSync(clientsPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return [];
    }
};

const saveClients = (clients) => {
    try {
        fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
    } catch (error) {
        logger.error('Error writing clients.json:', error);
    }
};

const isWithinOperatingHours = () => {
    const nowDenver = dayjs().tz('America/Denver');
    const hour = nowDenver.hour();
    const minute = nowDenver.minute();
    const timeInMinutes = hour * 60 + minute;

    const morningStart = 9 * 60 + 30; // 9:30
    const morningEnd = 11 * 60 + 30; // 11:30
    const afternoonStart = 14 * 60 + 30; // 14:30
    const afternoonEnd = 15 * 60 + 30; // 15:30

    return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
           (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Outbound call ended. Releasing lock for CallSid: ${callSid}`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const processNextCall = async () => {
    if (isCallActive) {
        return; // Lock prevents concurrency
    }

    if (!isWithinOperatingHours()) {
        return; // Wait, keep polling alive
    }

    const clients = getClients();
    const clientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (clientIndex === -1) {
        return; // Wait, no more clients pending
    }

    const client = clients[clientIndex];

    // Optimistic lock
    isCallActive = true;

    try {
        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
        logger.info(`Initiating Smart Drip call to ${client.phone}`);

        // Mark as CALLED immediately before sending the API request
        clients[clientIndex].status = 'CALLED';
        saveClients(clients);

        const call = await twilioClient.calls.create({
            to: client.phone,
            from: config.twilio.phoneNumber,
            twiml: `<Response><Connect><Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream?mode=outbound&callerId=${encodeURIComponent(client.phone)}" /></Connect></Response>`,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
            // Do NOT restrict statusCallbackEvent to ensure we catch all status changes
        });

        activeCallSid = call.sid;
        logger.info(`Outbound call created: ${call.sid}`);
    } catch (error) {
        logger.error(`Error executing outbound call to ${client.phone}:`, error);
        // Release lock on error
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (!dripInterval) {
        logger.info('Starting Smart Drip polling...');
        dripInterval = setInterval(processNextCall, 10000); // Poll every 10 seconds
        processNextCall(); // Initial check
    }
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Stopped Smart Drip polling.');
    }
};
