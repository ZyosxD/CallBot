import { promises as fs } from 'fs';
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
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkIsWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const time = now.format('HH:mm');

  // Morning: 9:30 AM - 11:30 AM (09:30 - 11:30)
  // Afternoon: 2:30 PM - 3:30 PM (14:30 - 15:30)

  const isMorning = time >= '09:30' && time <= '11:30';
  const isAfternoon = time >= '14:30' && time <= '15:30';

  return isMorning || isAfternoon;
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ended callback received for ${callSid}, releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processNextClient = async () => {
  if (isCallActive) {
    logger.info('Drip: Call already active, waiting.');
    return;
  }

  if (!checkIsWithinOperatingHours()) {
    logger.info('Drip: Outside operating hours, waiting.');
    return;
  }

  try {
    const data = await fs.readFile(clientsFile, 'utf8');
    const clients = JSON.parse(data);

    const pendingIndex = clients.findIndex(c => c.status === 'PENDING');
    if (pendingIndex === -1) {
      logger.info('Drip: No pending clients found. Waiting.');
      return;
    }

    const clientToCall = clients[pendingIndex];
    logger.info(`Drip: Found pending client ${clientToCall.phone}. Initiating call.`);

    // Optimistically lock
    isCallActive = true;

    // Mark as called immediately before Twilio API call
    clients[pendingIndex].status = 'CALLED';
    await fs.writeFile(clientsFile, JSON.stringify(clients, null, 2));

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Create outbound TwiML that connects to the streaming socket.
    // Notice we pass the client's phone number as callerId to match later logic.
    // Using absolute URL as Twilio requires it
    const twiml = `
    <Response>
      <Connect>
        <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
          <Parameter name="callerId" value="${clientToCall.phone}" />
          <Parameter name="mode" value="outbound" />
        </Stream>
      </Connect>
    </Response>`;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: clientToCall.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status`,
      // Do not restrict statusCallbackEvent to receive all terminal events
    });

    activeCallSid = call.sid;
    logger.info(`Drip: Call initiated successfully with SID ${call.sid}`);

  } catch (error) {
    logger.error('Drip: Error processing next client', error);
    // Release lock on error
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Campaign engine...');
  // Check every 30 seconds
  dripInterval = setInterval(processNextClient, 30000);
  // Trigger immediately on start
  processNextClient();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Campaign engine stopped.');
  }
};
