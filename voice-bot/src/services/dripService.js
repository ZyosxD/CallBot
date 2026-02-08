import twilio from 'twilio';
import { config } from '../config/config.js';
import * as leadService from './leadService.js';
import logger from '../utils/logger.js';
import eventBus from '../utils/events.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver'; // Mountain Time

class DripService {
  constructor() {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
    this.isRunning = false;
    this.callInProgress = false;

    // Listen for call ended event to trigger next call
    eventBus.on('callEnded', () => {
      logger.info('Call ended event received');
      this.callInProgress = false;
      if (this.isRunning) {
        // Add a small delay before next call
        setTimeout(() => this.processNextLead(), 5000);
      }
    });
  }

  start() {
    if (this.isRunning) {
        logger.info('Drip service already running');
        return;
    }
    logger.info('Starting Drip Service');
    this.isRunning = true;
    this.processNextLead();
  }

  stop() {
    logger.info('Stopping Drip Service');
    this.isRunning = false;
    // If a call is in progress, we let it finish, but we won't start a new one
    // because isRunning is false.
  }

  async processNextLead() {
    if (!this.isRunning) {
        logger.info('Drip service is stopped. Not processing next lead.');
        return;
    }

    if (this.callInProgress) {
        logger.info('Call in progress. Waiting...');
        return;
    }

    // Check time window again just in case (redundant if scheduler handles it, but safe)
    if (!this.isWithinOperatingHours()) {
        logger.info('Outside operating hours. Stopping drip.');
        this.stop();
        return;
    }

    try {
        const client = await leadService.getNextPendingClient();
        if (!client) {
            logger.info('No pending clients found.');
            this.stop(); // Or keep running and polling? Spec implies it goes through the list.
            return;
        }

        logger.info(`Processing client: ${client.name} (${client.phone})`);

        // Mark as CALLED immediately
        await leadService.updateClientStatus(client.id, 'CALLED');

        // Initiate Call
        await this.initiateCall(client);

    } catch (error) {
        logger.error('Error processing next lead:', error);
        this.callInProgress = false;
        // Try next one?
        setTimeout(() => this.processNextLead(), 5000);
    }
  }

  async initiateCall(client) {
    try {
        this.callInProgress = true;
        const callbackUrl = `${config.server.publicUrl}/voice/outbound?clientId=${client.id}&phone=${encodeURIComponent(client.phone)}`;

        logger.info(`Initiating call to ${client.phone} with callback ${callbackUrl}`);

        const call = await this.client.calls.create({
            url: callbackUrl,
            to: client.phone,
            from: config.twilio.phoneNumber,
            statusCallback: `${config.server.publicUrl}/voice/status`, // Optional: for status updates
            statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer'],
        });

        logger.info(`Call initiated. SID: ${call.sid}`);

    } catch (error) {
        logger.error(`Failed to initiate call to ${client.phone}:`, error);
        this.callInProgress = false;
        // Maybe mark client as FAILED?
        await leadService.updateClientStatus(client.id, 'FAILED_INIT');
        // Continue to next
        this.processNextLead();
    }
  }

  isWithinOperatingHours() {
    const now = dayjs().tz(TIMEZONE);
    const currentHour = now.hour();
    const currentMinute = now.minute();
    const currentTime = currentHour + (currentMinute / 60);

    // 9:30 AM = 9.5
    // 11:30 AM = 11.5
    // 2:30 PM = 14.5
    // 3:30 PM = 15.5

    const morningSession = currentTime >= 9.5 && currentTime < 11.5;
    const afternoonSession = currentTime >= 14.5 && currentTime < 15.5;

    return morningSession || afternoonSession;
  }
}

export const dripService = new DripService();
