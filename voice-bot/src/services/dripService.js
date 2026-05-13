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

const clientsFile = path.resolve('clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid || !activeCallSid) {
    logger.info(`Releasing lock for callSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);
  const afternoonStart = now.hour(14).minute(30).second(0); // 2:30 PM
  const afternoonEnd = now.hour(15).minute(30).second(0); // 3:30 PM

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
  logger.info('Starting Smart Drip service...');

  dripInterval = setInterval(async () => {
    if (isCallActive) {
      return;
    }

    if (!isWithinOperatingHours()) {
      return;
    }

    let clients = [];
    if (fs.existsSync(clientsFile)) {
      const fileData = fs.readFileSync(clientsFile, 'utf8');
      if (fileData) {
        clients = JSON.parse(fileData);
      }
    }

    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
      return; // No pending clients, wait for next tick
    }

    const client = clients[pendingClientIndex];
    isCallActive = true; // Set lock

    try {
      logger.info(`Initiating call to ${client.phone}`);

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        twiml: `<Response><Connect><Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream"><Parameter name="callerId" value="${client.phone}" /><Parameter name="mode" value="outbound" /></Stream></Connect></Response>`,
        statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
      });

      activeCallSid = call.sid;

      // Mark as called immediately after successful initiation
      clients[pendingClientIndex].status = 'CALLED';
      fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2), 'utf8');

      logger.info(`Call initiated with SID: ${call.sid}`);

    } catch (error) {
      logger.error(`Error dialing client ${client.phone}:`, error);
      isCallActive = false; // Release lock on error
      activeCallSid = null;
    }

  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    logger.info('Smart Drip service stopped.');
  }
};