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

// Lock variables
export let isCallActive = false;
export let activeCallSid = null;

const checkAndExecuteDrip = async () => {
  // Check timezone
  const nowInDenver = dayjs().tz('America/Denver');
  const hour = nowInDenver.hour();
  const minute = nowInDenver.minute();
  const totalMinutes = hour * 60 + minute;

  // 9:30-11:30 -> 570 to 690
  // 14:30-15:30 -> 870 to 930
  const isMorningWindow = totalMinutes >= 570 && totalMinutes <= 690;
  const isAfternoonWindow = totalMinutes >= 870 && totalMinutes <= 930;

  if (!isMorningWindow && !isAfternoonWindow) {
    return; // Wait for the next interval
  }

  if (isCallActive) {
    return; // Call is currently active, wait for it to finish
  }

  // Read clients.json
  if (!fs.existsSync(clientsFile)) return;
  const clientsData = fs.readFileSync(clientsFile, 'utf8');
  let clients;
  try {
    clients = JSON.parse(clientsData);
  } catch (e) {
    logger.error('Failed to parse clients.json');
    return;
  }

  // Find first PENDING contact
  const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');
  if (pendingClientIndex === -1) {
    return; // No pending clients found
  }

  const client = clients[pendingClientIndex];

  try {
    const clientPhone = client.phone;

    logger.info(`Starting outbound call to ${clientPhone}`);

    isCallActive = true;

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${config.server.publicUrl ? new URL(config.server.publicUrl).host : 'localhost'}/voice/stream?mode=outbound&amp;callerId=${clientPhone}" />
        </Connect>
      </Response>
    `;

    const statusCallbackUrl = config.server.publicUrl ? `${config.server.publicUrl}/voice/inbound/status` : null;

    const callConfig = {
      twiml: twiml,
      to: clientPhone,
      from: config.twilio.phoneNumber,
    };

    if (statusCallbackUrl) {
      callConfig.statusCallback = statusCallbackUrl;
    }

    const call = await twilioClient.calls.create(callConfig);
    activeCallSid = call.sid;

    // Mark as CALLED immediately after initiating
    clients[pendingClientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2), 'utf8');
    logger.info(`Outbound call initiated, CallSid: ${call.sid}`);

  } catch (err) {
    logger.error('Error starting outbound call:', err);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');
  // Check every 30 seconds
  dripInterval = setInterval(checkAndExecuteDrip, 30000);
  // Execute immediately
  checkAndExecuteDrip();
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
    logger.info(`Call ${callSid} ended, releasing lock`);
    isCallActive = false;
    activeCallSid = null;
  }
};
