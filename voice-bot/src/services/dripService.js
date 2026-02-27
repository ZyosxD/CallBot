import fs from 'fs/promises';
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
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
let currentCallSid = null; // Track current call SID

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  logger.info('Starting Smart Drip Service...');
  if (dripInterval) clearInterval(dripInterval);

  // Check every minute
  dripInterval = setInterval(async () => {
    const isOperating = isWithinOperatingHours();

    // If a call is active but operating hours have ended, terminate it
    if (isCallActive && !isOperating && currentCallSid) {
        logger.info(`Operating hours ended. Terminating active call ${currentCallSid}...`);
        try {
            await client.calls(currentCallSid).update({ status: 'completed' });
            logger.info(`Call ${currentCallSid} terminated successfully.`);
        } catch (error) {
            logger.error(`Failed to terminate call ${currentCallSid}:`, error);
        }
        // State will be updated by callback, but we can reset proactively if needed
        // setCallActive(false) is handled by callback
        return;
    }

    if (isCallActive) return;
    if (!isOperating) return;

    await processNextLead();
  }, 60 * 1000);
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip Service...');
  if (dripInterval) clearInterval(dripInterval);
};

export const setCallActive = (active, sid = null) => {
  isCallActive = active;
  currentCallSid = active ? sid : null;
  logger.info(`Call active status set to: ${active} (SID: ${sid || 'None'})`);
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 AM - 11:30 AM
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 2:30 PM - 3:30 PM
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const processNextLead = async () => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(data);

    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
      logger.info('No pending clients found.');
      return;
    }

    const clientToCall = clients[pendingClientIndex];

    // Mark as CALLED immediately
    clients[pendingClientIndex].status = 'CALLED';
    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    logger.info(`Initiating call to ${clientToCall.name} (${clientToCall.phone})`);
    await initiateCall(clientToCall);

  } catch (error) {
    logger.error('Error processing next lead:', error);
  }
};

const initiateCall = async (clientData) => {
  try {
    // Lock immediately
    isCallActive = true;

    // Normalize PUBLIC_URL to remove protocol if present, then ensure https:// for http call
    // config.server.publicUrl is expected to be like "https://myapp.com" based on README
    const publicUrl = config.server.publicUrl.replace(/^https?:\/\//, '');
    const baseUrl = `https://${publicUrl}`;

    const call = await client.calls.create({
      url: `${baseUrl}/voice/outbound?callerId=${encodeURIComponent(clientData.phone)}`,
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${baseUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    currentCallSid = call.sid;
    logger.info(`Call started: ${call.sid}`);
  } catch (error) {
    logger.error('Error initiating call:', error);
    setCallActive(false); // Release lock if call failed to start
  }
};

// Expose a way to generate TwiML for outbound calls
export const getOutboundTwiML = (callerId) => {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    const connect = response.connect();
    // Use wss:// for WebSocket
    const publicUrl = config.server.publicUrl.replace(/^https?:\/\//, '');
    const stream = connect.stream({
        url: `wss://${publicUrl}/voice/stream`,
    });
    stream.parameter({
        name: 'callerId',
        value: callerId
    });
    stream.parameter({
        name: 'mode',
        value: 'outbound'
    });
    return response.toString();
};
