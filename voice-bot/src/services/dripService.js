import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

// Ensure clients.json exists
if (!fs.existsSync(path.dirname(clientsFilePath))) {
    fs.mkdirSync(path.dirname(clientsFilePath), { recursive: true });
}
if (!fs.existsSync(clientsFilePath)) {
    fs.writeFileSync(clientsFilePath, JSON.stringify([], null, 2));
}

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');
    const hour = denverTime.hour();
    const minute = denverTime.minute();
    const timeInMinutes = hour * 60 + minute;

    // Morning: 9:30 AM - 11:30 AM
    const morningStart = 9 * 60 + 30;
    const morningEnd = 11 * 60 + 30;

    // Afternoon: 2:30 PM - 3:30 PM
    const afternoonStart = 14 * 60 + 30;
    const afternoonEnd = 15 * 60 + 30;

    return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
           (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

export const startDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
    }
    logger.info('Starting Smart Drip Service...');

    // Check every 30 seconds
    dripInterval = setInterval(processDrip, 30 * 1000);
    // Also process immediately
    processDrip();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
    }
    logger.info('Smart Drip Service stopped.');
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Active outbound call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const endActiveCall = async () => {
    if (activeCallSid) {
        try {
            const client = twilio(config.twilio.accountSid, config.twilio.authToken);
            logger.info(`Operating hours ended. Redirecting active call ${activeCallSid} to farewell message.`);

            const twiml = new twilio.twiml.VoiceResponse();
            twiml.say('Thanks for taking the time. Have a great day, goodbye!');
            twiml.hangup();

            await client.calls(activeCallSid).update({
                twiml: twiml.toString()
            });
            // We do not immediately release the lock here; wait for status callback to confirm completion
        } catch (error) {
             logger.error(`Error trying to end active call ${activeCallSid}:`, error);
        }
    }
}

const processDrip = async () => {
    try {
        if (!isWithinOperatingHours()) {
            // Check if there's an active call and end it respectfully
            if (isCallActive && activeCallSid) {
                await endActiveCall();
            }
            return;
        }

        if (isCallActive) {
            // Wait until current call is finished
            return;
        }

        let clients = JSON.parse(fs.readFileSync(clientsFilePath, 'utf-8'));
        const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

        if (pendingClientIndex !== -1) {
            const clientToCall = clients[pendingClientIndex];
            logger.info(`Smart Drip found pending contact: ${clientToCall.name} - ${clientToCall.phone}`);

            isCallActive = true;

            const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

            const host = new URL(config.server.publicUrl).host;

            const response = new twilio.twiml.VoiceResponse();
            const connect = response.connect();
            const stream = connect.stream({
                url: `wss://${host}/voice/stream`,
            });

            stream.parameter({ name: 'callerId', value: clientToCall.phone });
            stream.parameter({ name: 'mode', value: 'outbound' });

            const twimlString = response.toString();

            try {
                const call = await twilioClient.calls.create({
                    twiml: twimlString,
                    to: clientToCall.phone,
                    from: config.twilio.phoneNumber,
                    statusCallback: `${config.server.publicUrl}/voice/status-callback`,
                    statusCallbackEvent: ['completed'],
                    statusCallbackMethod: 'POST'
                });

                activeCallSid = call.sid;
                logger.info(`Initiated outbound call to ${clientToCall.phone}. CallSid: ${call.sid}`);

                // Mark as CALLED immediately after successfully initiating the call
                clients[pendingClientIndex].status = 'CALLED';
                fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));

            } catch (callError) {
                logger.error(`Failed to initiate call to ${clientToCall.phone}:`, callError);
                isCallActive = false; // Release lock if call failed to initiate
                activeCallSid = null;
            }
        }
    } catch (error) {
        logger.error('Error in processDrip:', error);
    }
};
