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
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;
let twilioClient = null;

const isWithinOperatingHours = () => {
    const denverTime = dayjs().tz('America/Denver');
    const hour = denverTime.hour();
    const minute = denverTime.minute();

    const currentMinutes = hour * 60 + minute;

    // 9:30 AM = 9 * 60 + 30 = 570
    // 11:30 AM = 11 * 60 + 30 = 690
    const isMorning = currentMinutes >= 570 && currentMinutes <= 690;

    // 2:30 PM = 14 * 60 + 30 = 870
    // 3:30 PM = 15 * 60 + 30 = 930
    const isAfternoon = currentMinutes >= 870 && currentMinutes <= 930;

    return isMorning || isAfternoon;
};

const getPendingClient = () => {
    try {
        if (!fs.existsSync(CLIENTS_FILE)) return null;
        const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
        const clients = JSON.parse(data);
        return clients.find(c => c.status === 'PENDING');
    } catch (error) {
        logger.error('Error reading clients.json:', error);
        return null;
    }
};

const markClientCalled = (phoneNumber) => {
    try {
        const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
        const clients = JSON.parse(data);
        const updatedClients = clients.map(c => {
            if (c.phone === phoneNumber) {
                return { ...c, status: 'CALLED' };
            }
            return c;
        });
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(updatedClients, null, 2));
    } catch (error) {
        logger.error('Error updating clients.json:', error);
    }
};

const processDrip = async () => {
    if (isCallActive) {
        return; // Wait for the active call to finish
    }

    if (!isWithinOperatingHours()) {
        return; // Outside of operating hours, keep polling
    }

    const pendingClient = getPendingClient();
    if (!pendingClient) {
        return; // No pending clients, keep polling
    }

    isCallActive = true;
    logger.info(`Initiating outbound call to ${pendingClient.phone}`);

    try {
        if (!twilioClient) {
            twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
        }

        const publicUrl = config.server.publicUrl || `http://localhost:${config.server.port}`;
        // Encode TwiML via inline <Connect><Stream> OR an endpoint. Master spec mentioned passing callerId
        // The master spec says we shouldn't use inline TwiML if we use `url` param.
        // We will call the /voice/outbound-twiml route to get the Twiml and stream url.
        const outboundTwimlUrl = `${publicUrl}/voice/outbound-twiml?callerId=${encodeURIComponent(pendingClient.phone)}`;

        const call = await twilioClient.calls.create({
            to: pendingClient.phone,
            from: config.twilio.phoneNumber,
            url: outboundTwimlUrl,
            statusCallback: `${publicUrl}/voice/status`,
            statusCallbackMethod: 'POST'
            // Do not restrict statusCallbackEvent to ensure we get completed/failed/canceled
        });

        activeCallSid = call.sid;
        markClientCalled(pendingClient.phone);
        logger.info(`Call initiated. CallSid: ${call.sid}`);

    } catch (error) {
        logger.error('Error initiating outbound call:', error);
        isCallActive = false; // Reset lock if it fails to start
        activeCallSid = null;
    }
};

export const startDrip = () => {
    logger.info('Smart Drip engine started.');
    // Check every 30 seconds
    dripInterval = setInterval(processDrip, 30000);
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip engine stopped.');
    }
};

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Active outbound call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};