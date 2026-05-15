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

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');

    const morningStart = now.hour(9).minute(30).second(0);
    const morningEnd = now.hour(11).minute(30).second(0);

    const afternoonStart = now.hour(14).minute(30).second(0); // 2:30 PM
    const afternoonEnd = now.hour(15).minute(30).second(0);   // 3:30 PM

    const isMorning = now.isBetween(morningStart, morningEnd, null, '[)');
    const isAfternoon = now.isBetween(afternoonStart, afternoonEnd, null, '[)');

    return isMorning || isAfternoon;
};

const readClients = async () => {
    try {
        const data = await fs.readFile(CLIENTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile(CLIENTS_FILE, JSON.stringify([]));
            return [];
        }
        logger.error('Error reading clients.json:', error);
        return [];
    }
};

const saveClients = async (clients) => {
    try {
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
    } catch (error) {
        logger.error('Error saving clients.json:', error);
    }
};

const initiateOutboundCall = async (clientData) => {
    try {
        const client = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Pass callerId (client phone) securely, not through chained stream.parameter here,
        // but it will be picked up via outbound-api detection in callController
        // wait, we can't reliably detect request.body.To on Twilio Webhooks if it's not present.
        // Actually, the trace says:
        // "dripService.js passes the client's phone number (not name) as the callerId parameter when generating the outbound TwiML URL."

        // Let's pass it via URL query params since TwiML inline shouldn't have `url` param to avoid API conflict errors.
        // Trace: "Do not use the url parameter in twilioClient.calls.create when passing twiml directly inline, to avoid Twilio API conflict errors."

        // Wait, TwiML generation is done in twilioClient.calls.create inline.
        const twiml = `
            <Response>
                <Connect>
                    <Stream url="wss://${new URL(config.server.publicUrl || 'https://localhost').host}/voice/stream">
                        <Parameter name="callerId" value="${clientData.phone}" />
                        <Parameter name="mode" value="outbound" />
                    </Stream>
                </Connect>
            </Response>
        `;

        const call = await client.calls.create({
            twiml: twiml,
            to: clientData.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/inbound/status`
        });

        activeCallSid = call.sid;
        logger.info(`Outbound call initiated to ${clientData.phone}. CallSid: ${activeCallSid}`);
        return true;
    } catch (error) {
        logger.error(`Error initiating outbound call to ${clientData.phone}:`, error);
        return false;
    }
};


const processNextCall = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside operating hours. Waiting for the next window...');
        return;
    }

    isCallActive = true;

    try {
        const clients = await readClients();
        const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

        if (pendingClientIndex === -1) {
            logger.info('No pending clients found in the list.');
            isCallActive = false;
            return;
        }

        const clientData = clients[pendingClientIndex];
        logger.info(`Found pending client: ${clientData.phone}`);

        const success = await initiateOutboundCall(clientData);

        if (success) {
            clients[pendingClientIndex].status = 'CALLED';
            await saveClients(clients);
        } else {
            isCallActive = false; // Free up lock if call fails to initiate
        }
    } catch (error) {
        logger.error('Error processing next call:', error);
        isCallActive = false;
    }
};

export const startDrip = () => {
    if (dripInterval) {
        logger.warn('Drip campaign is already running.');
        return;
    }

    logger.info('Starting Smart Drip Campaign...');
    // Initial check immediately
    processNextCall();

    // Poll every 10 seconds to check for next call
    dripInterval = setInterval(processNextCall, 10000);
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Stopped Smart Drip Campaign.');
    }
};

export const markCallEnded = (callSid) => {
    if (callSid === activeCallSid || !activeCallSid) {
        logger.info(`Marking call ${callSid} as ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    } else {
        logger.info(`Ignoring markCallEnded for ${callSid} as it does not match activeCallSid ${activeCallSid}`);
    }
};
