import twilio from 'twilio';
import { config } from '../config/config.js';
import { getPendingClient, updateClientStatus } from './leadService.js';
import logger from '../utils/logger.js';

let isCallActive = false;
let nextCallTimeout = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const makeNextCall = async () => {
  if (isCallActive) {
    logger.info('Call currently active. Waiting for it to finish.');
    return;
  }

  const pendingClient = getPendingClient();
  if (!pendingClient) {
    logger.info('No pending clients found.');
    return;
  }

  try {
    isCallActive = true;
    updateClientStatus(pendingClient.id, 'CALLED');

    logger.info(`Initiating call to ${pendingClient.name} (${pendingClient.phone})`);

    const call = await client.calls.create({
      to: pendingClient.phone,
      from: config.twilio.phoneNumber,
      url: `${config.server.publicUrl}/voice/inbound?direction=outbound&clientId=${pendingClient.id}&phone=${encodeURIComponent(pendingClient.phone)}`,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    logger.info(`Call initiated. SID: ${call.sid}`);

  } catch (error) {
    logger.error('Error initiating call:', error);
    isCallActive = false; // Reset if initiation fails
    // Optionally schedule retry
  }
};

export const callEnded = () => {
  logger.info('Call ended. ready for next call.');
  isCallActive = false;

  // Debounce next call slightly to allow cleanup
  if (nextCallTimeout) clearTimeout(nextCallTimeout);
  nextCallTimeout = setTimeout(() => {
     makeNextCall();
  }, 5000); // 5 seconds delay before next check
};

export const stopDrip = () => {
    if (nextCallTimeout) clearTimeout(nextCallTimeout);
    logger.info("Drip service stopped.");
}
