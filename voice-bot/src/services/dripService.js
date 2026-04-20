import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import twilio from 'twilio';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');
const POLLING_INTERVAL = 30000; // 30 seconds

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeInMinutes = hour * 60 + minute;

  // Morning: 9:30 AM (570) - 11:30 AM (690)
  const isMorning = timeInMinutes >= 570 && timeInMinutes <= 690;
  // Afternoon: 2:30 PM (870) - 3:30 PM (930)
  const isAfternoon = timeInMinutes >= 870 && timeInMinutes <= 930;

  return isMorning || isAfternoon;
};

const getNextPendingContact = () => {
  if (!fs.existsSync(CLIENTS_FILE)) {
    return null;
  }

  const rawData = fs.readFileSync(CLIENTS_FILE, 'utf8');
  let clients = [];
  try {
    clients = JSON.parse(rawData);
  } catch (error) {
    logger.error('Error parsing clients.json', error);
    return null;
  }

  const index = clients.findIndex(c => c.status === 'PENDING');
  if (index === -1) return null;

  const contact = clients[index];
  return { contact, index, clients };
};

const initiateOutboundCall = async (contact) => {
  try {
    isCallActive = true;
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);

    logger.info(`Initiating outbound call to ${contact.phone}`);

    // Construct TwiML directly to pass callerId and mode without conflicting 'url'
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
            <Parameter name="callerId" value="${contact.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await client.calls.create({
      twiml: twiml,
      to: contact.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
      // Do not restrict statusCallbackEvent to ensure we get all events to release the lock
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);
    return true;
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
    return false;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip engine is already running.');
    return;
  }

  logger.info('Starting Smart Drip Engine...');
  dripInterval = setInterval(async () => {
    try {
      if (isCallActive) {
        return; // Wait for the active call to finish
      }

      if (!isWithinOperatingHours()) {
        return; // Wait for operating hours
      }

      const nextContactData = getNextPendingContact();
      if (!nextContactData) {
        return; // No pending contacts
      }

      const { contact, index, clients } = nextContactData;

      const success = await initiateOutboundCall(contact);
      if (success) {
        // Mark as CALLED immediately after initiating call
        clients[index].status = 'CALLED';
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
        logger.info(`Contact ${contact.phone} marked as CALLED.`);
      }

    } catch (error) {
      logger.error('Error in drip polling loop:', error);
    }
  }, POLLING_INTERVAL);
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
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
  }
};
