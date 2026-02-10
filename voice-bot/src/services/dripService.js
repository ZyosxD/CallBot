import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { getNextPendingClient, markClientCalled } from './leadService.js';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

let isDripActive = false;
let isCallInProgress = false;
let nextCallTimeout = null;

export async function startDrip() {
  if (isDripActive) {
    logger.info('Drip is already active.');
    return;
  }
  logger.info('Starting Smart Drip...');
  isDripActive = true;
  makeNextCall();
}

export function stopDrip() {
  logger.info('Stopping Smart Drip...');
  isDripActive = false;
  if (nextCallTimeout) {
    clearTimeout(nextCallTimeout);
    nextCallTimeout = null;
  }
}

export async function makeNextCall() {
  if (!isDripActive) {
    logger.info('Drip stopped, not making next call.');
    return;
  }

  if (isCallInProgress) {
    logger.info('Call in progress, waiting...');
    return;
  }

  // Debounce/Safety delay
  if (nextCallTimeout) clearTimeout(nextCallTimeout);

  nextCallTimeout = setTimeout(async () => {
    try {
      const contact = await getNextPendingClient();

      if (!contact) {
        logger.info('No pending contacts found. Drip finished or paused.');
        // Optionally stop drip or check again later?
        // For now, we just stop to avoid loops if empty.
        // But maybe we want to keep checking? The spec says "Busca el primer contacto".
        // If empty, we can just wait.
        return;
      }

      logger.info(`Initiating call to ${contact.name} (${contact.phone})...`);

      // Mark as CALLED immediately to avoid duplicates
      await markClientCalled(contact.id);

      isCallInProgress = true;

      const publicUrl = config.server.publicUrl; // e.g. https://my-app.com

      // TwiML for the call
      // We need to point to a TwiML URL or use immediate TwiML.
      // Twilio Client .calls.create({ url: ... }) expects a URL that returns TwiML.
      // So we need an endpoint in our server that returns the TwiML for outbound calls.
      // Let's assume /voice/outbound-twiml

      await client.calls.create({
        to: contact.phone,
        from: config.twilio.phoneNumber,
        url: `${publicUrl}/voice/outbound-twiml?clientId=${contact.id}&phone=${encodeURIComponent(contact.phone)}`,
        statusCallback: `${publicUrl}/voice/status`,
        statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled'],
        machineDetection: 'Enable', // Optional: Detect voicemail
      });

    } catch (error) {
      logger.error('Error making next call:', error);
      isCallInProgress = false;
      // Retry or move on? If error, maybe wait a bit and try next.
      nextCallTimeout = setTimeout(makeNextCall, 10000);
    }
  }, 2000); // 2 second debounce before starting logic
}

export function onCallEnded() {
  logger.info('Call ended signal received.');
  isCallInProgress = false;
  if (isDripActive) {
    // Wait a bit before next call
    logger.info('Waiting 5s before next call...');
    nextCallTimeout = setTimeout(() => {
        makeNextCall();
    }, 5000);
  }
}
