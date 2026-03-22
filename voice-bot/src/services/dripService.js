import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
export let activeCallSid = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeStr = hour + minute / 60; // 9:30 = 9.5

  const isMorning = timeStr >= 9.5 && timeStr < 11.5;
  const isAfternoon = timeStr >= 14.5 && timeStr < 15.5;

  return isMorning || isAfternoon;
};

const getPendingClient = () => {
  try {
    const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
    const index = clients.findIndex(c => c.status === 'PENDING');
    if (index !== -1) {
      const client = clients[index];
      clients[index].status = 'CALLED';
      fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
      return client;
    }
  } catch (error) {
    logger.error('Error reading clients.json:', error);
  }
  return null;
};

const makeOutboundCall = async (client) => {
  try {
    const clientPhone = client.phone; // Assuming clients have a 'phone' field
    if (!clientPhone) {
        logger.error('Client is missing a phone number.');
        isCallActive = false;
        return;
    }

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Inline TwiML with Connect and Stream
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
            <Parameter name="callerId" value="${clientPhone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    logger.info(`Initiating outbound call to ${clientPhone}`);

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: clientPhone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated. CallSid: ${activeCallSid}`);
  } catch (error) {
    logger.error('Error creating outbound call via Twilio:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processQueue = async () => {
  if (isCallActive) {
    return; // Wait for the active call to finish
  }

  if (!isWithinOperatingHours()) {
    return; // Do not process queue outside operating hours, wait for next tick
  }

  const client = getPendingClient();
  if (client) {
    isCallActive = true;
    await makeOutboundCall(client);
  }
};

export const markCallEnded = (endedCallSid) => {
  if (activeCallSid === endedCallSid) {
    logger.info(`Outbound call ${endedCallSid} ended. Releasing queue lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip Engine...');
  // Check queue every 15 seconds
  dripInterval = setInterval(processQueue, 15000);
  processQueue(); // initial tick
};

export const stopDrip = () => {
  if (dripInterval) {
    logger.info('Stopping Smart Drip Engine...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
};