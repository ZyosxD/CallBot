import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let dripInterval = null;
let currentCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const hour = now.hour();
    const minute = now.minute();
    const timeInMinutes = hour * 60 + minute;

    const morningStart = 9 * 60 + 30; // 9:30 AM
    const morningEnd = 11 * 60 + 30; // 11:30 AM
    const afternoonStart = 14 * 60 + 30; // 2:30 PM
    const afternoonEnd = 15 * 60 + 30; // 3:30 PM

    if ((timeInMinutes >= morningStart && timeInMinutes < morningEnd) ||
        (timeInMinutes >= afternoonStart && timeInMinutes < afternoonEnd)) {
        return true;
    }
    return false;
};

export const startDrip = () => {
    logger.info('Starting Smart Drip service...');
    if (dripInterval) clearInterval(dripInterval);

    dripInterval = setInterval(async () => {
        if (!isWithinOperatingHours()) {
            if (isCallActive && currentCallSid) {
                logger.info(`Operating hours ended. Ending active call ${currentCallSid}.`);
                try {
                    await twilioClient.calls(currentCallSid).update({
                        twiml: '<Response><Say voice="alice">Thank you for your time. Have a great day.</Say><Hangup/></Response>'
                    });
                } catch (error) {
                    logger.error(`Failed to end call ${currentCallSid}: ${error.message}`);
                }
            }
            return;
        }

        if (isCallActive) return;

        try {
            if (!fs.existsSync(clientsPath)) {
                logger.error('clients.json not found');
                return;
            }

            const clientsData = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
            const pendingClientIndex = clientsData.findIndex(c => c.status === 'PENDING');

            if (pendingClientIndex !== -1) {
                const client = clientsData[pendingClientIndex];

                // Lock the call and update status to prevent duplicates
                isCallActive = true;
                clientsData[pendingClientIndex].status = 'CALLED';
                fs.writeFileSync(clientsPath, JSON.stringify(clientsData, null, 2));

                logger.info(`Initiating Smart Drip call to: ${client.name} at ${client.phone}`);

                // Inline TwiML generation for outbound
                const VoiceResponse = twilio.twiml.VoiceResponse;
                const response = new VoiceResponse();
                const connect = response.connect();
                const stream = connect.stream({
                    url: `wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream`
                });
                stream.parameter({ name: 'mode', value: 'SARAH_OUTBOUND' });
                stream.parameter({ name: 'callerId', value: client.phone }); // Set callerId to client's phone

                const call = await twilioClient.calls.create({
                    twiml: response.toString(),
                    to: client.phone,
                    from: config.twilio.phoneNumber,
                    statusCallback: `${config.server.publicUrl}/voice/status-callback`,
                    statusCallbackEvent: ['completed', 'answered', 'failed', 'busy', 'no-answer', 'canceled'],
                    statusCallbackMethod: 'POST'
                });

                currentCallSid = call.sid;
                logger.info(`Call initiated with SID: ${call.sid}`);
            } else {
                logger.info('No pending clients found in Smart Drip.');
            }
        } catch (error) {
            logger.error(`Error in Smart Drip: ${error.message}`);
            isCallActive = false; // Release lock on error
        }
    }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
    logger.info('Stopping Smart Drip service...');
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
    }
};

export const onCallEnded = () => {
    logger.info('Call ended. Releasing Smart Drip lock.');
    isCallActive = false;
    currentCallSid = null;
};
