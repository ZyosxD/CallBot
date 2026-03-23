import twilio from 'twilio';
import { config } from '../config/config.js';
import { readData, writeData } from '../utils/dataStore.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

  return isMorning || isAfternoon;
};

export const startDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
  }
  logger.info('Starting Smart Drip Engine...');

  dripInterval = setInterval(async () => {
    if (!isWithinOperatingHours()) {
      return;
    }

    if (isCallActive) {
      return;
    }

    const clients = readData('clients.json');
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
      return;
    }

    const clientToCall = clients[pendingClientIndex];
    isCallActive = true;

    try {
      // Inline TwiML generation to avoid dependency loops and missing dependencies
      const twiml = `
        <Response>
          <Connect>
            <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
              <Parameter name="mode" value="outbound" />
              <Parameter name="callerId" value="${clientToCall.phone}" />
            </Stream>
          </Connect>
        </Response>
      `;

      const call = await twilioClient.calls.create({
        twiml: twiml,
        to: clientToCall.phone,
        from: config.twilio.phoneNumber,
        statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      });

      activeCallSid = call.sid;
      logger.info(`Initiated outbound call to ${clientToCall.phone}, CallSid: ${call.sid}`);

      // Mark as called immediately
      clients[pendingClientIndex].status = 'CALLED';
      writeData('clients.json', clients);

    } catch (error) {
      logger.error(`Error making outbound call to ${clientToCall.phone}:`, error);
      isCallActive = false; // Release lock on error
      activeCallSid = null;
    }
  }, 10000); // Check every 10 seconds
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Outbound call ${callSid} ended. Released Smart Drip lock.`);
  }
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};
