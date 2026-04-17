import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { readJsonFile, writeJsonFile } from '../utils/dataStore.js';

dayjs.extend(utc);
dayjs.extend(timezone);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeInMinutes = hour * 60 + minute;

  const morningStart = 9 * 60 + 30; // 9:30 AM
  const morningEnd = 11 * 60 + 30; // 11:30 AM
  const afternoonStart = 14 * 60 + 30; // 2:30 PM
  const afternoonEnd = 15 * 60 + 30; // 3:30 PM

  return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
         (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

const processNextCall = async () => {
  if (isCallActive) {
    return; // Wait for the active call to finish
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours. Waiting...');
    return;
  }

  try {
    const clients = await readJsonFile('clients.json');
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('No pending clients found. Waiting...');
      return;
    }

    const client = clients[nextClientIndex];
    logger.info(`Initiating call to ${client.phone}`);

    isCallActive = true;

    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
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
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated with SID: ${activeCallSid}`);

    // Mark as CALLED immediately after initiating to prevent duplicates
    clients[nextClientIndex].status = 'CALLED';
    await writeJsonFile('clients.json', clients);

  } catch (error) {
    logger.error('Error in drip process:', error);
    isCallActive = false; // Reset lock if call fails to initiate
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');
  dripInterval = setInterval(processNextCall, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    logger.info('Stopping Smart Drip Engine...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
