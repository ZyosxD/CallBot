import fs from 'fs/promises';
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

const dataPath = path.join(process.cwd(), 'src', 'data', 'clients.json');
let twilioClient;

try {
  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
} catch (error) {
  logger.error('Failed to initialize Twilio client in dripService:', error);
}

// Concurrency locks
let isCallActive = false;
let activeCallSid = null;
let dripIntervalId = null;

const DRIP_INTERVAL_MS = 15000; // Check queue every 15 seconds

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');

  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);

  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const markCallEnded = (callSid) => {
  if (activeCallSid && activeCallSid === callSid) {
    logger.info(`Releasing lock for call: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processNextCall = async () => {
  if (isCallActive) return;

  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours for Drip Campaign. Waiting...');
    return;
  }

  try {
    const fileContent = await fs.readFile(dataPath, 'utf-8');
    const clients = JSON.parse(fileContent);

    const clientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (clientIndex === -1) {
      logger.info('No PENDING clients left in the queue. Waiting...');
      return;
    }

    const client = clients[clientIndex];

    logger.info(`Initiating call to ${client.phone} (ID: ${client.id})`);

    // Acquire lock
    isCallActive = true;

    // Use absolute URL from config.server.publicUrl for callback and ws
    const baseUrl = config.server.publicUrl ? (config.server.publicUrl.endsWith('/') ? config.server.publicUrl.slice(0, -1) : config.server.publicUrl) : 'https://example.ngrok.app';
    const host = new URL(baseUrl).host;

    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${host}/voice/stream">
            <Parameter name="mode" value="outbound" />
            <Parameter name="callerId" value="${client.phone}" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${baseUrl}/voice/status`,
      // Do not use statusCallbackEvent array to ensure we receive all events
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);

    // Mark as CALLED only after Twilio request succeeds
    clients[clientIndex].status = 'CALLED';
    await fs.writeFile(dataPath, JSON.stringify(clients, null, 2));

  } catch (error) {
    logger.error('Error in Drip Campaign processNextCall:', error);
    // Release lock on critical failure
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripIntervalId) {
    logger.info('Drip campaign is already running.');
    return;
  }
  logger.info('Starting Smart Drip Campaign...');
  dripIntervalId = setInterval(processNextCall, DRIP_INTERVAL_MS);
};

export const stopDrip = () => {
  if (dripIntervalId) {
    logger.info('Stopping Smart Drip Campaign...');
    clearInterval(dripIntervalId);
    dripIntervalId = null;
  }
};
