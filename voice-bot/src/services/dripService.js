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

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const dataDir = path.resolve('src/data');
const clientsFile = path.join(dataDir, 'clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const markCallEnded = (callSid) => {
  if (callSid && callSid === activeCallSid) {
    logger.info(`Call ended lock released for ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const format = 'HH:mm';
  const currentTime = now.format(format);

  const morningStart = dayjs('09:30', format);
  const morningEnd = dayjs('11:30', format);
  const afternoonStart = dayjs('14:30', format);
  const afternoonEnd = dayjs('15:30', format);

  const current = dayjs(currentTime, format);

  return current.isBetween(morningStart, morningEnd, null, '[]') ||
         current.isBetween(afternoonStart, afternoonEnd, null, '[]');
};

const processNextClient = async () => {
  if (isCallActive) {
    logger.info('Drip: Call currently active, waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Drip: Outside of operating hours, waiting...');
    return;
  }

  let clients = [];
  try {
    if (fs.existsSync(clientsFile)) {
      clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
    }
  } catch (error) {
    logger.error('Drip: Error reading clients.json', error);
    return;
  }

  const clientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (clientIndex === -1) {
    logger.info('Drip: No PENDING clients left, waiting...');
    return;
  }

  const client = clients[clientIndex];
  logger.info(`Drip: Initiating call for ${client.phone}`);
  isCallActive = true;

  try {
    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: `
        <Response>
          <Connect>
            <Stream url="wss://${config.server.publicUrl?.replace(/^https?:\/\//, '') || 'localhost:3000'}/voice/stream">
              <Parameter name="callerId" value="${client.phone}" />
              <Parameter name="mode" value="outbound" />
            </Stream>
          </Connect>
        </Response>
      `,
      statusCallback: `${config.server.publicUrl || 'http://localhost:3000'}/voice/inbound/status`
    });

    activeCallSid = call.sid;
    logger.info(`Drip: Call started ${call.sid}`);

    clients[clientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

  } catch (error) {
    logger.error('Drip: Error initiating outbound call', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (!dripInterval) {
    logger.info('Starting Smart Drip Engine...');
    dripInterval = setInterval(processNextClient, 10000); // Check every 10 seconds
  }
};

export const stopDrip = () => {
  if (dripInterval) {
    logger.info('Stopping Smart Drip Engine...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
};
