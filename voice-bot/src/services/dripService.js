import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const clientsFile = path.resolve('src/data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip polling...');
  // Check every 15 seconds
  dripInterval = setInterval(processDrip, 15000);
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip polling stopped.');
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
  const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);
  const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
  const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const processDrip = async () => {
  if (isCallActive) return; // Wait for current call to finish

  if (!isWithinOperatingHours()) {
      return; // Return and wait, don't stop interval
  }

  try {
    if (!fs.existsSync(clientsFile)) return;

    let clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));

    const clientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (clientIndex === -1) {
       return; // No pending clients, wait.
    }

    const client = clients[clientIndex];

    // Lock and initiate call
    isCallActive = true;

    logger.info(`Initiating outbound call to ${client.name} at ${client.phone}`);

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Generate TwiML inline so we don't need a public URL, but we pass the callerId (client.phone)
    const host = config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : 'localhost:3000';
    const streamUrl = `wss://${host}/voice/stream`;

    const twiml = `
      <Response>
        <Connect>
          <Stream url="${streamUrl}">
            <Parameter name="callerId" value="${client.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const statusCallbackUrl = config.server.publicUrl ? `${config.server.publicUrl}/voice/inbound/status` : null;

    const callOpts = {
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
    };

    if (statusCallbackUrl) {
       callOpts.statusCallback = statusCallbackUrl;
       callOpts.statusCallbackEvent = ['initiated', 'ringing', 'answered', 'completed', 'busy', 'failed', 'no-answer', 'canceled']; // all events
       callOpts.statusCallbackMethod = 'POST';
    }

    const call = await twilioClient.calls.create(callOpts);

    activeCallSid = call.sid;
    logger.info(`Call created with SID: ${activeCallSid}`);

    // Mark as CALLED immediately
    clients[clientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

  } catch (error) {
    logger.error('Error processing drip queue:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const markCallEnded = async (callSid) => {
   if (callSid && activeCallSid && callSid === activeCallSid) {
       logger.info(`Releasing lock for call SID: ${callSid}`);
       isCallActive = false;
       activeCallSid = null;
   }
};
