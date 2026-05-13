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

const clientsFile = path.resolve('clients.json');
let isDripRunning = false;
let dripInterval = null;

// Concurrency locks
let isCallActive = false;
let activeCallSid = null;

const checkSchedule = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
  const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);

  const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
  const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
  if (isDripRunning) return;
  isDripRunning = true;
  logger.info('Smart Drip service started');

  dripInterval = setInterval(async () => {
    if (isCallActive) {
      return; // Wait until current call is finished
    }

    if (!checkSchedule()) {
      return; // Wait until within allowed hours
    }

    let clients = [];
    try {
      const fileData = await fs.readFile(clientsFile, 'utf8');
      clients = JSON.parse(fileData);
    } catch (e) {
      // If file doesn't exist, we can just return and wait
      return;
    }

    const pendingIndex = clients.findIndex(c => c.status === 'PENDING');
    if (pendingIndex === -1) {
      return; // No pending clients, wait
    }

    const targetClient = clients[pendingIndex];

    try {
      isCallActive = true;
      const client = twilio(config.twilio.accountSid, config.twilio.authToken);

      const call = await client.calls.create({
        to: targetClient.phone,
        from: config.twilio.phoneNumber,
        twiml: `<Response>
            <Connect>
                <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
                    <Parameter name="callerId" value="${targetClient.phone}" />
                    <Parameter name="mode" value="outbound" />
                </Stream>
            </Connect>
        </Response>`,
        statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'failed', 'no-answer', 'canceled']
      });

      activeCallSid = call.sid;
      logger.info(`Outbound call initiated to ${targetClient.phone}, CallSid: ${call.sid}`);

      // Mark as CALLED only after successfully initiating the API call
      clients[pendingIndex].status = 'CALLED';
      await fs.writeFile(clientsFile, JSON.stringify(clients, null, 2));

    } catch (error) {
      logger.error(`Error initiating call to ${targetClient.phone}:`, error);
      // Release lock on error to try next time
      isCallActive = false;
      activeCallSid = null;
    }

  }, 15000); // Poll every 15 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
  }
  isDripRunning = false;
  logger.info('Smart Drip service stopped');
};

export const markCallEnded = (callSid) => {
  if (isCallActive && activeCallSid === callSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Smart Drip lock released for CallSid: ${callSid}`);
  }
};
