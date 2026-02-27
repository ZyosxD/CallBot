import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let currentCallSid = null;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

const loadClients = () => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error loading clients:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error saving clients:', error);
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz(config.drip.timezone);
  const currentTime = now.format('HH:mm');

  const morningStart = config.drip.morningStart;
  const morningEnd = config.drip.morningEnd;
  const afternoonStart = config.drip.afternoonStart;
  const afternoonEnd = config.drip.afternoonEnd;

  const isMorning = currentTime >= morningStart && currentTime <= morningEnd;
  const isAfternoon = currentTime >= afternoonStart && currentTime <= afternoonEnd;

  return isMorning || isAfternoon;
};

const initiateCall = async (clientData) => {
  if (isCallActive) {
    logger.info('Call already active, skipping...');
    return;
  }

  isCallActive = true;
  logger.info(`Initiating call to ${clientData.name} (${clientData.phone})`);

  try {
    // The Url should point to our TwiML generating endpoint
    // We need to pass the callerId as a query parameter so the controller can pick it up
    const call = await client.calls.create({
      url: `${config.server.publicUrl}/voice/inbound?callerId=${encodeURIComponent(clientData.phone)}`,
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled'],
      statusCallbackMethod: 'POST'
    });

    logger.info(`Call initiated: ${call.sid}`);
    currentCallSid = call.sid;

    // Update client status
    const clients = loadClients();
    const updatedClients = clients.map(c =>
      c.id === clientData.id ? { ...c, status: 'CALLED', lastCallSid: call.sid } : c
    );
    saveClients(updatedClients);

  } catch (error) {
    logger.error(`Error calling ${clientData.name}:`, error);
    isCallActive = false; // Release lock on error
    currentCallSid = null;
  }
};

const terminateActiveCall = async () => {
    if (!currentCallSid) return;

    logger.info(`Operating hours ended. Gracefully terminating active call: ${currentCallSid}`);
    try {
        // Attempt to redirect the call to a TwiML that says goodbye, then hangs up
        // This is more polite than a hard hangup
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("I'm sorry, our operating hours have ended. Please visit our website for more information. Goodbye.");
        twiml.hangup();

        await client.calls(currentCallSid).update({ twiml: twiml.toString() });
        logger.info(`Call ${currentCallSid} redirected to farewell message.`);

        // We don't reset currentCallSid immediately here, let the status callback handle the final cleanup
        // But we might want to ensure we don't try to terminate again immediately
    } catch (error) {
        logger.error(`Error terminating call ${currentCallSid}:`, error);
        // Fallback to hard hangup if redirect fails
        try {
             await client.calls(currentCallSid).update({ status: 'completed' });
        } catch (e) {
            logger.error(`Hard hangup failed for ${currentCallSid}:`, e);
        }
    }
};

export const startDrip = () => {
  logger.info('Starting Smart Drip Service...');

  if (dripInterval) {
    clearInterval(dripInterval);
  }

  dripInterval = setInterval(async () => {
    if (!isWithinOperatingHours()) {
      if (isCallActive && currentCallSid) {
          // Check if we haven't already tried to terminate it (optional logic could go here)
          await terminateActiveCall();
          // Force reset locally to avoid repeated termination attempts while waiting for callback
          // But ideally we wait for callback. For simplicity, we'll let the next interval check handle it
          // or rely on the status callback.
          // To prevent loop, maybe we flag it?
          // For now, let's assume the redirect happens quickly.
      }
      return;
    }

    if (isCallActive) {
        return;
    }

    const clients = loadClients();
    const pendingClient = clients.find(c => c.status === 'PENDING');

    if (pendingClient) {
      await initiateCall(pendingClient);
    } else {
      // logger.info('No pending clients found.');
    }

  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
    if (dripInterval) {
        clearInterval(dripInterval);
        dripInterval = null;
    }
    logger.info('Smart Drip Service stopped.');
};

// Callback to release lock
export const handleCallStatusUpdate = (callSid, status) => {
    logger.info(`Call ${callSid} status update: ${status}`);
    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
        if (currentCallSid === callSid) {
            isCallActive = false;
            currentCallSid = null;
            logger.info('Call finished, releasing lock.');
        } else if (isCallActive && !currentCallSid) {
             isCallActive = false;
             logger.info('Call finished (sid mismatch or null), releasing lock.');
        }
    }
};
