import fs from 'fs/promises';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');
const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');

  const morningStart = denverTime.clone().hour(9).minute(30).second(0);
  const morningEnd = denverTime.clone().hour(11).minute(30).second(0);

  const afternoonStart = denverTime.clone().hour(14).minute(30).second(0);
  const afternoonEnd = denverTime.clone().hour(15).minute(30).second(0);

  return denverTime.isBetween(morningStart, morningEnd) || denverTime.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip service...');

  // Run check every 30 seconds
  dripInterval = setInterval(processNextClient, 30000);

  // Also run immediately
  processNextClient();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip service.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid || !activeCallSid) {
    logger.info(`Releasing lock for call ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processNextClient = async () => {
  if (isCallActive) {
    return; // Wait for the current call to finish
  }

  if (!isWithinOperatingHours()) {
    return; // Just return and wait, don't stop the interval
  }

  try {
    const fileData = await fs.readFile(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(fileData);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
    if (nextClientIndex === -1) {
      return; // No pending clients, wait for new ones
    }

    const client = clients[nextClientIndex];

    // Mark as lock before API call
    isCallActive = true;

    logger.info(`Initiating call to ${client.phone}`);

    const publicUrl = config.server.publicUrl;

    // TwiML inline, pass phone as callerId to stream
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
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/inbound/status` // No array restriction
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated with SID: ${call.sid}`);

    // Successfully initiated, mark as called
    clients[nextClientIndex].status = 'CALLED';
    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf8');

  } catch (error) {
    logger.error('Error processing drip campaign:', error);
    // Release lock on error
    isCallActive = false;
    activeCallSid = null;
  }
};
