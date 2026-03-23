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
const clientsPath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

export const markCallEnded = (callSid) => {
    if (activeCallSid === callSid) {
        logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        activeCallSid = null;
    }
};

const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const timeVal = now.hour() * 100 + now.minute();

    const morningWindow = timeVal >= 930 && timeVal <= 1130;
    const afternoonWindow = timeVal >= 1430 && timeVal <= 1530;

    return morningWindow || afternoonWindow;
};

const processNextClient = async () => {
    if (isCallActive) {
        return;
    }

    if (!isWithinOperatingHours()) {
        logger.info('Outside operating hours. Pausing Smart Drip.');
        return;
    }

    try {
        const rawData = fs.readFileSync(clientsPath, 'utf-8');
        const clients = JSON.parse(rawData);

        const targetIndex = clients.findIndex(c => c.status === 'PENDING');

        if (targetIndex === -1) {
            logger.info('No pending clients left in queue.');
            return;
        }

        const client = clients[targetIndex];

        // Mark as CALLED before initiating to prevent duplicates
        clients[targetIndex].status = 'CALLED';
        fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

        isCallActive = true;

        logger.info(`Initiating Smart Drip call to ${client.phone}`);

        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

        const host = config.server.publicUrl ? new URL(config.server.publicUrl).host : 'localhost';

        // Important: Setting inline TwiML, so we shouldn't use the url parameter!
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/voice/stream">
      <Parameter name="mode" value="outbound"/>
      <Parameter name="callerId" value="${client.phone}"/>
    </Stream>
  </Connect>
</Response>`;

        const call = await twilioClient.calls.create({
            twiml: twiml,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl || 'http://localhost:3000'}/voice/status-callback`,
            statusCallbackMethod: 'POST'
        });

        activeCallSid = call.sid;
        logger.info(`Call initiated. SID: ${activeCallSid}`);

    } catch (error) {
        logger.error('Error processing next client in Smart Drip:', error);
        isCallActive = false;
        activeCallSid = null;
    }
};

export const startDrip = () => {
    if (dripInterval) {
        logger.info('Smart Drip is already running.');
        return;
    }

    logger.info('Starting Smart Drip engine...');
    // Check every 30 seconds
    dripInterval = setInterval(processNextClient, 30000);
    // Execute immediately once
    processNextClient();
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
        logger.info('Smart Drip engine stopped.');
    }
};
