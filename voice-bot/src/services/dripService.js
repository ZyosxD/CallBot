import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  const isMorning = timeStr >= '09:30' && timeStr < '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr < '15:30';

  return isMorning || isAfternoon;
};

const readClients = () => {
  const filePath = path.join(process.cwd(), 'src', 'data', 'clients.json');
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
};

const writeClients = (clients) => {
  const filePath = path.join(process.cwd(), 'src', 'data', 'clients.json');
  fs.writeFileSync(filePath, JSON.stringify(clients, null, 2));
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip Engine...');

  dripInterval = setInterval(async () => {
    if (isCallActive) return;

    if (!checkOperatingHours()) {
      logger.info('Out of operating hours for Drip Campaign. Waiting...');
      return;
    }

    const clients = readClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('No PENDING clients left in the queue. Waiting...');
      return;
    }

    const client = clients[nextClientIndex];

    try {
      isCallActive = true;
      const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

      const twiml = `
        <Response>
          <Connect>
            <Stream url="wss://${new URL(config.server.publicUrl || 'http://localhost:3000').host}/voice/stream">
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
        statusCallback: `${config.server.publicUrl}/voice/inbound/status`
      });

      activeCallSid = call.sid;
      logger.info(`Outbound call initiated to ${client.phone} with SID: ${activeCallSid}`);

      clients[nextClientIndex].status = 'CALLED';
      writeClients(clients);

    } catch (error) {
      logger.error('Error initiating outbound call:', error);
      isCallActive = false;
      activeCallSid = null;
    }

  }, 15000); // Poll every 15 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Releasing lock for call SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
