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

let dripInterval;
let isCallActive = false;
let activeCallSid = null;

const checkOperatingHours = () => {
    const now = dayjs().tz('America/Denver');

    // Parse the start/end times relative to today in MT
    const morningStart = dayjs.tz(`${now.format('YYYY-MM-DD')} 09:30:00`, 'YYYY-MM-DD HH:mm:ss', 'America/Denver');
    const morningEnd = dayjs.tz(`${now.format('YYYY-MM-DD')} 11:30:00`, 'YYYY-MM-DD HH:mm:ss', 'America/Denver');

    const afternoonStart = dayjs.tz(`${now.format('YYYY-MM-DD')} 14:30:00`, 'YYYY-MM-DD HH:mm:ss', 'America/Denver');
    const afternoonEnd = dayjs.tz(`${now.format('YYYY-MM-DD')} 15:30:00`, 'YYYY-MM-DD HH:mm:ss', 'America/Denver');

    return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const getPendingClient = () => {
    try {
        if (!fs.existsSync(clientsFilePath)) return null;
        const clients = JSON.parse(fs.readFileSync(clientsFilePath, 'utf8'));
        return clients.find(c => c.status === 'PENDING');
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return null;
    }
};

const markClientCalled = (phoneNumber) => {
    try {
        const clients = JSON.parse(fs.readFileSync(clientsFilePath, 'utf8'));
        const updatedClients = clients.map(c => {
            if (c.phone === phoneNumber) {
                return { ...c, status: 'CALLED' };
            }
            return c;
        });
        fs.writeFileSync(clientsFilePath, JSON.stringify(updatedClients, null, 2));
    } catch (error) {
        logger.error('Error updating clients.json:', error);
    }
};

export const startDrip = () => {
    if (dripInterval) {
        logger.warn('Smart Drip is already running.');
        return;
    }

    logger.info('Starting Smart Drip service...');
    dripInterval = setInterval(async () => {
        if (isCallActive) {
            return; // Wait for the active call to complete
        }

        if (!checkOperatingHours()) {
            return; // Wait for operating hours
        }

        const client = getPendingClient();
        if (!client) {
            return; // Wait for more clients
        }

        logger.info(`Starting outbound call to ${client.phone}`);
        isCallActive = true;

        try {
            const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
            const serverUrl = config.server.publicUrl;
            // Generate Twiml inline
            const twiml = `
                <Response>
                    <Connect>
                        <Stream url="wss://${serverUrl ? serverUrl.replace('https://', '').replace('http://', '') : 'localhost'}/voice/stream">
                            <Parameter name="callerId" value="${client.phone}" />
                            <Parameter name="mode" value="outbound" />
                        </Stream>
                    </Connect>
                </Response>
            `;

            const call = await twilioClient.calls.create({
                twiml: twiml,
                to: client.phone,
                from: config.twilio.phoneNumber,
                statusCallback: `${serverUrl}/voice/inbound/status`,
                statusCallbackMethod: 'POST'
            });

            activeCallSid = call.sid;
            logger.info(`Call initiated. SID: ${call.sid}`);
            markClientCalled(client.phone); // Mark called only after successful initiation

        } catch (error) {
            logger.error(`Error creating outbound call to ${client.phone}:`, error);
            isCallActive = false;
            activeCallSid = null;
        }

    }, 15000); // Check every 15 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip service stopped.');
    }
};

export const markCallEnded = (callSid) => {
    // Only release lock if the ending call is the outbound call we initiated
    if (activeCallSid === callSid) {
        logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};
