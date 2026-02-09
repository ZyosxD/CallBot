import twilio from 'twilio';
import { config } from '../config/config.js';
import * as leadService from './leadService.js';
import eventBus from '../utils/events.js';
import logger from '../utils/logger.js';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

let isRunning = false;
let currentCallSid = null;
let nextCallTimeout = null;

export const startDrip = async () => {
  if (isRunning) {
    logger.info('Drip service is already running.');
    return;
  }

  logger.info('Starting Drip Service...');
  isRunning = true;
  makeNextCall();
};

export const stopDrip = () => {
  logger.info('Stopping Drip Service...');
  isRunning = false;
  if (nextCallTimeout) {
    clearTimeout(nextCallTimeout);
    nextCallTimeout = null;
  }
};

const makeNextCall = async () => {
  if (!isRunning) return;

  try {
    const pendingClient = await leadService.getNextPendingClient();

    if (!pendingClient) {
      logger.info('No pending clients found. Drip service finished for now.');
      isRunning = false;
      return;
    }

    logger.info(`Initiating call for client: ${pendingClient.name} (${pendingClient.phone})`);

    // Mark as called immediately to avoid duplicates
    await leadService.updateClientStatus(pendingClient.id, 'CALLED');

    const callbackUrl = `${config.server.publicUrl}/voice/outbound-twiml?clientId=${pendingClient.id}`;

    const call = await client.calls.create({
      url: callbackUrl,
      to: pendingClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`, // Optional: for status updates
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    currentCallSid = call.sid;
    logger.info(`Call started: ${call.sid}`);

  } catch (error) {
    logger.error(`Error in makeNextCall: ${error.message}`);
    // If error, maybe wait a bit and try next?
    // For now, let's wait 30s and retry to avoid tight loop on error
    setTimeout(makeNextCall, 30000);
  }
};

// Listen for call completion from the CallController/OpenAI Service
eventBus.on('callEnded', (data) => {
  logger.info(`Call ended event received for SID: ${data.callSid}`);

  // Debounce to prevent double-triggering
  if (nextCallTimeout) {
    clearTimeout(nextCallTimeout);
  }

  if (isRunning) {
    // Wait a small buffer before next call?
    // Spec says: "Espera a que termine esa llamada por completo antes de buscar el siguiente."
    nextCallTimeout = setTimeout(() => {
      makeNextCall();
      nextCallTimeout = null;
    }, 5000); // 5s buffer
  }
});
