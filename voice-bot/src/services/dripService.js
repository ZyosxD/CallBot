import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

// Ensure clients file exists
const ensureClientsFile = () => {
  if (!fs.existsSync(clientsFilePath)) {
    fs.writeFileSync(clientsFilePath, JSON.stringify([], null, 2), 'utf8');
  }
};

const getClients = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    logger.error('Error reading clients.json:', err);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf8');
  } catch (err) {
    logger.error('Error writing clients.json:', err);
  }
};

export const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const time = now.hour() * 100 + now.minute(); // HHMM

  // Morning: 9:30 AM - 11:30 AM -> 0930 - 1130
  // Afternoon: 2:30 PM - 3:30 PM -> 1430 - 1530
  if ((time >= 930 && time <= 1130) || (time >= 1430 && time <= 1530)) {
    return true;
  }
  return false;
};

const endActiveCallRespectfully = async () => {
    if (!activeCallSid) return;
    try {
        logger.info(`Operating hours ended. Gracefully ending call ${activeCallSid}...`);
        const client = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Redirect the call to a TwiML that plays a goodbye message and hangs up
        const twiml = `
          <Response>
            <Say voice="Polly.Joanna-Neural">Our office hours are closing. Thanks for your time, goodbye!</Say>
            <Hangup />
          </Response>
        `;

        await client.calls(activeCallSid).update({ twiml: twiml });
        logger.info(`Call ${activeCallSid} redirected for respectful termination.`);

        // Manually unlock here or wait for status callback
        isCallActive = false;
        activeCallSid = null;
    } catch (err) {
        logger.error(`Error terminating call ${activeCallSid}:`, err);
    }
};

export const executeDrip = async () => {
  if (isCallActive) {
    logger.info('A call is already active. Skipping drip cycle.');

    // Check if we passed operating hours during an active call
    if (!isWithinOperatingHours() && activeCallSid) {
        await endActiveCallRespectfully();
    }
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours (Denver Time). Drip cycle paused.');
    return;
  }

  ensureClientsFile();
  const clients = getClients();

  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No pending clients found in Smart Drip queue.');
    return;
  }

  const clientData = clients[nextClientIndex];

  // Lock the queue and update status BEFORE the API call to prevent duplicates
  isCallActive = true;
  clients[nextClientIndex].status = 'CALLED';
  saveClients(clients);

  logger.info(`Initiating outbound call to ${clientData.name} at ${clientData.phone}`);

  try {
    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const host = new URL(config.server.publicUrl).host;

    // Pass callerId (client phone) and mode outbound
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${host}/voice/stream">
            <Parameter name="callerId" value="${clientData.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated successfully. Call SID: ${activeCallSid}`);
  } catch (error) {
    logger.error('Failed to initiate outbound call:', error);
    // If Twilio API fails, revert the lock so it can be retried or system can recover
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip engine is already running.');
    return;
  }
  // Check every 30 seconds
  dripInterval = setInterval(executeDrip, 30000);
  executeDrip(); // Run immediately on start
  logger.info('Smart Drip Engine started.');
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Active call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  } else {
    logger.info(`Call ended callback received for ${callSid}, but it is not the active outbound call. Ignored.`);
  }
};
