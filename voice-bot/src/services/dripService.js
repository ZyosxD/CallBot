import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { getClients, updateClientStatus } from './dataService.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

let twilioClient;
if (config.twilio.accountSid && config.twilio.authToken) {
  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
}

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const nowDenver = dayjs().tz('America/Denver');
  const timeStr = nowDenver.format('HH:mm');

  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

  return isMorning || isAfternoon;
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Outbound call ended. Releasing lock for CallSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const makeNextCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.debug('Outside operating hours. Waiting...');
    return;
  }

  if (!twilioClient) {
    logger.warn('Twilio client not configured. Cannot make outbound call.');
    return;
  }

  try {
    const clients = await getClients();
    const nextClient = clients.find(c => c.status === 'PENDING');

    if (!nextClient) {
      logger.info('No more pending clients to call.');
      return;
    }

    // Set lock
    isCallActive = true;

    // Optimistically update status to prevent double-calling
    await updateClientStatus(nextClient.phoneNumber, 'CALLED');

    logger.info(`Initiating outbound call to ${nextClient.phoneNumber}`);

    const call = await twilioClient.calls.create({
      to: nextClient.phoneNumber,
      from: config.twilio.phoneNumber,
      twiml: `
        <Response>
          <Connect>
            <Stream url="wss://${config.server.publicUrl}/voice/stream">
              <Parameter name="callerId" value="${nextClient.phoneNumber}" />
              <Parameter name="mode" value="outbound" />
            </Stream>
          </Connect>
        </Response>
      `,
      statusCallback: `https://${config.server.publicUrl}/voice/outbound/status`,
      record: false
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. CallSid: ${call.sid}`);

  } catch (error) {
    logger.error('Error making next call:', error);
    // Release lock on error
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip service...');
  // Check every 10 seconds
  dripInterval = setInterval(makeNextCall, 10000);
  makeNextCall(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip service.');
  }
};
