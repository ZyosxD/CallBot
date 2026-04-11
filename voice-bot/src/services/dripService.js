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
let intervalId = null;
let isCallActive = false;
export let activeCallSid = null;

// Determine if current time in Denver is within operating hours:
// 9:30-11:30 AM or 2:30-3:30 PM
const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  return (timeStr >= '09:30' && timeStr <= '11:30') ||
         (timeStr >= '14:30' && timeStr <= '15:30');
};

const getPendingClient = () => {
  if (!fs.existsSync(clientsFile)) return null;
  try {
    const data = fs.readFileSync(clientsFile, 'utf8');
    const clients = JSON.parse(data);
    const index = clients.findIndex(c => c.status === 'PENDING');
    if (index !== -1) {
      return { client: clients[index], index, clients };
    }
  } catch (error) {
    logger.error('Error reading clients.json:', error);
  }
  return null;
};

const markClientCalled = (clients, index) => {
  clients[index].status = 'CALLED';
  try {
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error updating clients.json:', error);
  }
};

export const startDrip = () => {
  if (intervalId) return;

  logger.info('Smart Drip campaign starting...');
  intervalId = setInterval(async () => {
    if (isCallActive) {
      return;
    }

    if (!isWithinOperatingHours()) {
      return; // Just wait for operating hours
    }

    const pending = getPendingClient();
    if (!pending) {
      return; // No pending clients, wait
    }

    const { client, index, clients } = pending;
    isCallActive = true;
    logger.info(`Initiating Smart Drip call to ${client.phone}`);

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const publicUrl = config.server.publicUrl;

    // We pass callerId as the query parameter, the callerId is the client phone number being dialed
    const url = `${publicUrl}/voice/inbound?callerId=${encodeURIComponent(client.phone)}`;

    try {
      const twiml = `
        <Response>
          <Connect>
            <Stream url="wss://${new URL(publicUrl).host}/voice/stream">
              <Parameter name="mode" value="outbound" />
            </Stream>
          </Connect>
        </Response>
      `;

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        twiml: twiml,
        statusCallback: `${publicUrl}/voice/inbound/status`
        // Removed statusCallbackEvent restrict to receive all terminal status updates.
      });

      activeCallSid = call.sid;
      markClientCalled(clients, index);
      logger.info(`Call dispatched to ${client.phone}. CallSid: ${call.sid}`);
    } catch (error) {
      logger.error('Failed to dispatch Twilio call:', error);
      isCallActive = false; // Reset lock if failed to dial
    }
  }, 10000); // Check every 10 seconds
};

export const markCallEnded = (callSid) => {
  // Only release the lock if the active call SID matches
  // This prevents inbound calls from prematurely releasing the outbound lock.
  if (activeCallSid && activeCallSid === callSid) {
    logger.info(`Releasing active outbound call lock for CallSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const stopDrip = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Smart Drip campaign stopped.');
  }
};
