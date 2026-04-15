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

const clientsPath = path.resolve('src/data/clients.json');
let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const time = hour + minute / 60;

  const isMorning = time >= 9.5 && time < 11.5; // 9:30 to 11:30
  const isAfternoon = time >= 14.5 && time < 15.5; // 14:30 to 15:30

  return isMorning || isAfternoon;
};

const getPendingClient = () => {
  if (!fs.existsSync(clientsPath)) return null;
  const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
  const pendingIndex = clients.findIndex(c => c.status === 'PENDING');
  if (pendingIndex === -1) return null;

  const client = clients[pendingIndex];

  return { client, clients, pendingIndex };
};

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip engine is already running.');
    return;
  }

  logger.info('Starting Smart Drip Engine...');

  dripInterval = setInterval(async () => {
    if (isCallActive) return;
    if (!isWithinOperatingHours()) return;

    const pendingData = getPendingClient();
    if (!pendingData) return; // No pending clients, but wait until there are

    const { client, clients, pendingIndex } = pendingData;
    isCallActive = true;

    try {
      logger.info(`Initiating drip call to ${client.phone}`);

      const publicUrl = config.server.publicUrl;
      const twiml = `
        <Response>
          <Connect>
            <Stream url="wss://${publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
              <Parameter name="callerId" value="${client.phone}" />
              <Parameter name="mode" value="outbound" />
            </Stream>
          </Connect>
        </Response>
      `;

      const call = await twilioClient.calls.create({
        twiml,
        to: client.phone,
        from: config.twilio.phoneNumber,
        statusCallback: `${publicUrl}/voice/inbound/status`
        // statusCallbackEvent intentionally omitted to receive all events
      });

      activeCallSid = call.sid;

      // Update status immediately after initiating the call
      clients[pendingIndex].status = 'CALLED';
      fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

      logger.info(`Call initiated. CallSid: ${activeCallSid}`);
    } catch (error) {
      logger.error('Error initiating drip call:', error);
      isCallActive = false; // Reset lock if failed
      activeCallSid = null;
    }

  }, 10000); // Poll every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Releasing drip lock for callSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};