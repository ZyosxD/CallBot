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

const clientsFile = path.resolve('src/data/clients.json');
let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

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

  const isMorning = timeInMinutes >= morningStart && timeInMinutes <= morningEnd;
  const isAfternoon = timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd;

  return isMorning || isAfternoon;
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');

  // Check every 30 seconds
  dripInterval = setInterval(processNextLead, 30000);

  // Immediately process first to start without waiting 30s
  processNextLead();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Engine.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processNextLead = async () => {
  if (isCallActive) {
    logger.info('Smart Drip: Call currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Smart Drip: Outside operating hours (Mountain Time). Waiting...');
    return;
  }

  if (!fs.existsSync(clientsFile)) {
    logger.warn('Smart Drip: clients.json not found.');
    return;
  }

  try {
    const data = fs.readFileSync(clientsFile, 'utf8');
    const clients = JSON.parse(data);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('Smart Drip: No PENDING clients found.');
      return;
    }

    const client = clients[nextClientIndex];

    // Mark as CALLED immediately to avoid duplicates in case of crash/race condition
    clients[nextClientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

    logger.info(`Smart Drip: Initiating call to ${client.name} at ${client.phone}`);
    isCallActive = true;

    // Use absolute URL from config.server.publicUrl if available
    const host = config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : 'localhost:3000';
    const streamUrl = `wss://${host}/voice/stream`;

    // Initiate the Twilio call
    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      // We pass the callerId (client.phone) via custom parameters, and also mode
      twiml: `<Response>
        <Connect>
          <Stream url="${streamUrl}">
            <Parameter name="mode" value="outbound" />
            <Parameter name="callerId" value="${client.phone}" />
          </Stream>
        </Connect>
      </Response>`,
      statusCallback: `https://${host}/voice/inbound/status`,
      statusCallbackMethod: 'POST'
      // Removing statusCallbackEvent array so we get all events, ensuring lock releases reliably
    });

    activeCallSid = call.sid;
    logger.info(`Smart Drip: Call created with SID: ${call.sid}`);

  } catch (err) {
    logger.error('Error processing next lead:', err);
    // Release lock on error
    isCallActive = false;
    activeCallSid = null;
  }
};
