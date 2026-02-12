import { getNextPendingClient, updateClientStatus } from './leadService.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

let isDripActive = false;
let currentCallSid = null;
let nextCallTimeout = null;

export const startDrip = async () => {
  if (isDripActive) {
    logger.info('Drip is already active.');
    return;
  }
  logger.info('Starting Smart Drip...');
  isDripActive = true;
  makeNextCall();
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip...');
  isDripActive = false;
  if (nextCallTimeout) {
    clearTimeout(nextCallTimeout);
    nextCallTimeout = null;
  }
  // If a call is in progress, we let it finish, but handleCallStatus will check isDripActive and not continue.
};

const makeNextCall = async () => {
  if (!isDripActive) return;

  try {
    const nextClient = await getNextPendingClient();
    if (!nextClient) {
      logger.info('No pending clients found. Drip paused.');
      isDripActive = false;
      return;
    }

    // Mark as CALLED immediately
    await updateClientStatus(nextClient.id, 'CALLED');

    logger.info(`Initiating call to ${nextClient.name} (${nextClient.phone})`);

    const publicUrl = config.server.publicUrl;
    if (!publicUrl) {
        logger.error('PUBLIC_URL not set. Cannot make calls.');
        isDripActive = false;
        return;
    }

    // Initiate Call
    const call = await client.calls.create({
      url: `${publicUrl}/voice/outbound-twiml?clientId=${nextClient.id}`,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/status`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
    });

    currentCallSid = call.sid;
    logger.info(`Call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error making next call:', error);
    // If error (e.g. invalid number), try next one after short delay
    nextCallTimeout = setTimeout(() => {
        makeNextCall();
    }, 10000);
  }
};

export const handleCallStatus = async (callSid, status) => {
  if (callSid !== currentCallSid) return;

  logger.info(`Call ${callSid} status: ${status}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
    currentCallSid = null;
    if (isDripActive) {
      // Debounce slightly to allow cleanup and respect "wait for call to finish completely"
      nextCallTimeout = setTimeout(() => {
        makeNextCall();
      }, 5000);
    }
  }
};
