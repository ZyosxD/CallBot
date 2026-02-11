import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { getNextPendingClient, updateClientStatus } from './leadService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver';

let dripActive = false;
let nextCallTimeout = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export function startDrip() {
  if (dripActive) return;
  dripActive = true;
  logger.info('Starting Smart Drip Service');
  checkAndCallNext();
}

export function stopDrip() {
  dripActive = false;
  if (nextCallTimeout) {
    clearTimeout(nextCallTimeout);
    nextCallTimeout = null;
  }
  logger.info('Stopping Smart Drip Service');
}

function isWithinTimeWindow() {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();
  const time = hour + minute / 60;

  // 9:30 AM - 11:30 AM (9.5 - 11.5)
  const morningWindow = time >= 9.5 && time <= 11.5;

  // 2:30 PM - 3:30 PM (14.5 - 15.5)
  const afternoonWindow = time >= 14.5 && time <= 15.5;

  return morningWindow || afternoonWindow;
}

export async function checkAndCallNext() {
  if (!dripActive) return;

  if (!isWithinTimeWindow()) {
    logger.info('Outside of calling hours. Pausing drip.');
    // Check again in 15 minutes
    nextCallTimeout = setTimeout(checkAndCallNext, 15 * 60 * 1000);
    return;
  }

  try {
    const clientData = await getNextPendingClient();
    if (!clientData) {
      logger.info('No pending clients found.');
      // Check again in 1 hour
      nextCallTimeout = setTimeout(checkAndCallNext, 60 * 60 * 1000);
      return;
    }

    logger.info(`Initiating call for client: ${clientData.name} (${clientData.phone})`);

    // Mark as CALLED immediately
    await updateClientStatus(clientData.id, 'CALLED');

    const publicUrl = config.server.publicUrl;
    if (!publicUrl) {
        logger.error('PUBLIC_URL not set in config. Cannot make outbound calls.');
        return;
    }

    const call = await client.calls.create({
      url: `${publicUrl}/voice/outbound-twiml?clientId=${clientData.id}&phone=${encodeURIComponent(clientData.phone)}`,
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/status`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
    });

    logger.info(`Call initiated: ${call.sid}`);

    // Wait for the call to finish effectively?
    // Actually, we rely on the statusCallback or simple delay.
    // The "MASTER SPECIFICATION" says: "Espera a que termine esa llamada por completo antes de buscar el siguiente."
    // This implies we shouldn't schedule the next call immediately.
    // We should wait for the call to end.
    // We can do this by NOT setting a timeout here, but rather having the `callEnded` event trigger `makeNextCall`.
    // However, for simplicity and robustness (in case callback is missed), we can set a long timeout or just rely on the status callback.

    // The memory mentions: "The `dripService.js` implements a debouncing mechanism on the `makeNextCall` function to prevent multiple simultaneous calls triggered by rapid status callbacks."

  } catch (error) {
    logger.error('Error in checkAndCallNext:', error);
    // Retry in 5 minutes on error
    nextCallTimeout = setTimeout(checkAndCallNext, 5 * 60 * 1000);
  }
}

// Function to be called when a call ends (from webhook)
export function makeNextCall() {
    if (nextCallTimeout) clearTimeout(nextCallTimeout);

    // Debounce slightly to allow system to settle
    nextCallTimeout = setTimeout(() => {
        checkAndCallNext();
    }, 10000); // 10 seconds delay between calls
}
