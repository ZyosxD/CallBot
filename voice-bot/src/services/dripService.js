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

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
const CLIENTS_FILE = path.join(process.cwd(), 'src/data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const isWithinOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const hour = denverTime.hour();
  const minute = denverTime.minute();
  const currentTime = hour + minute / 60;

  // 9:30 AM (9.5) to 11:30 AM (11.5)
  // 2:30 PM (14.5) to 3:30 PM (15.5)
  const isMorning = currentTime >= 9.5 && currentTime < 11.5;
  const isAfternoon = currentTime >= 14.5 && currentTime < 15.5;

  return isMorning || isAfternoon;
};

const getPendingContact = () => {
  if (!fs.existsSync(CLIENTS_FILE)) {
    return null;
  }
  const data = fs.readFileSync(CLIENTS_FILE, 'utf-8');
  const clients = JSON.parse(data);
  const contact = clients.find(c => c.status === 'PENDING');
  return contact;
};

const markContactAsCalled = (contactId) => {
  const data = fs.readFileSync(CLIENTS_FILE, 'utf-8');
  let clients = JSON.parse(data);
  const index = clients.findIndex(c => c.id === contactId);
  if (index !== -1) {
    clients[index].status = 'CALLED';
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  }
};

const executeCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours (Mountain Time). Waiting...');
    return;
  }

  const contact = getPendingContact();
  if (!contact) {
    logger.info('No pending contacts found. Waiting...');
    return;
  }

  isCallActive = true;
  markContactAsCalled(contact.id);

  try {
    const publicUrl = config.server.publicUrl;
    const callerId = contact.phone; // Important: pass the phone number

    // Generate inline TwiML using string templates
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
      <Parameter name="mode" value="outbound" />
      <Parameter name="callerId" value="${callerId}" />
    </Stream>
  </Connect>
</Response>`;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: contact.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/status-callback`,
    });

    activeCallSid = call.sid;
    logger.info(`Started outbound call to ${contact.phone}, CallSid: ${call.sid}`);

  } catch (error) {
    logger.error('Error starting outbound call:', error);
    isCallActive = false; // Reset lock on error
  }
};

export const startDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
  }
  logger.info('Starting Smart Drip engine...');
  // Check every 30 seconds
  dripInterval = setInterval(executeCall, 30000);
  executeCall(); // Initial check
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip engine.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ${callSid} ended, releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
