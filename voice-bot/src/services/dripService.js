import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '..', 'data', 'clients.json');

let isCallActive = false;
let dripInterval = null;

const checkTimeAndStart = () => {
    // Current time in Mountain Time
    const nowMT = dayjs().tz('America/Denver');

    const isMorning = nowMT.hour() === 9 && nowMT.minute() >= 30 || nowMT.hour() === 10 || nowMT.hour() === 11 && nowMT.minute() <= 30;
    const isAfternoon = nowMT.hour() === 14 && nowMT.minute() >= 30 || nowMT.hour() === 15 && nowMT.minute() <= 30;

    if (isMorning || isAfternoon) {
        if (!isCallActive) {
            initiateNextCall();
        }
    } else {
        logger.info('Outside of operating hours (9:30-11:30 AM or 2:30-3:30 PM MT). Drip paused.');
    }
};

const initiateNextCall = async () => {
  try {
    const clientsData = fs.readFileSync(clientsPath, 'utf8');
    const clients = JSON.parse(clientsData);

    const pendingIndex = clients.findIndex(client => client.status === 'PENDING');

    if (pendingIndex === -1) {
      logger.info('No pending clients found. Stopping drip service.');
      stopDrip();
      return;
    }

    // Lock and mark as called immediately to prevent concurrent duplicate calls
    isCallActive = true;
    clients[pendingIndex].status = 'CALLED';
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

    const client = clients[pendingIndex];
    logger.info(`Initiating outbound call to ${client.name} (${client.phone})`);

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Generate inline TwiML for outbound call
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
        <Parameter name="callerId" value="${client.phone}" />
        <Parameter name="mode" value="outbound" />
    </Stream>
  </Connect>
</Response>`;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'], // Strict requirement
      statusCallbackMethod: 'POST'
    });

    logger.info(`Call initiated. CallSid: ${call.sid}`);

  } catch (error) {
    logger.error(`Error initiating outbound call: ${error.message}`);
    // Release lock on error
    isCallActive = false;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip service...');

  if (!config.server.publicUrl) {
    logger.error('Cannot start Drip Service: PUBLIC_URL is missing.');
    return;
  }

  dripInterval = setInterval(checkTimeAndStart, 60000); // Check every minute
  checkTimeAndStart(); // Check immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip service stopped.');
  }
};

export const handleCallEnded = () => {
  logger.info('Call ended. Releasing active call lock.');
  isCallActive = false;
};
