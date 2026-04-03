import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsPath = path.resolve('src/data/clients.json');
let intervalId = null;
export let isCallActive = false;
export let activeCallSid = null;

const checkOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const hour = denverTime.hour();
  const minute = denverTime.minute();
  const timeInMinutes = hour * 60 + minute;

  // 9:30 AM to 11:30 AM (9*60+30=570 to 11*60+30=690)
  const isMorningWindow = timeInMinutes >= 570 && timeInMinutes <= 690;
  // 2:30 PM to 3:30 PM (14*60+30=870 to 15*60+30=930)
  const isAfternoonWindow = timeInMinutes >= 870 && timeInMinutes <= 930;

  return isMorningWindow || isAfternoonWindow;
};

const getClients = () => {
  if (!fs.existsSync(clientsPath)) {
    return [];
  }
  const data = fs.readFileSync(clientsPath, 'utf8');
  try {
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
};

const saveClients = (clients) => {
  fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Outbound call ${callSid} ended. Drip queue unlocked.`);
  }
};

const pollAndCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!checkOperatingHours()) {
    return; // Wait for the window, keep polling
  }

  const clients = getClients();
  if (clients.length === 0) {
    return;
  }

  const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');
  if (pendingClientIndex === -1) {
    return;
  }

  const clientToCall = clients[pendingClientIndex];

  // Instantly mark as CALLED before doing the async call
  clients[pendingClientIndex].status = 'CALLED';
  saveClients(clients);

  isCallActive = true;
  logger.info(`Initiating outbound call to ${clientToCall.phone}`);

  try {
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Construct TwiML URL. Add callerId correctly to pass it to the WS later.
    // Also add mode=outbound
    const twimlUrl = `${config.server.publicUrl}/voice/inbound?mode=outbound&callerId=${encodeURIComponent(clientToCall.phone)}`;

    const call = await client.calls.create({
      url: twimlUrl,
      to: clientToCall.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    // If it fails immediately, unlock
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (intervalId) return;
  logger.info('Starting Smart Drip Engine...');
  // Poll every 10 seconds
  intervalId = setInterval(pollAndCall, 10000);
  pollAndCall(); // execute immediately once
};

export const stopDrip = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Smart Drip Engine stopped.');
  }
};
