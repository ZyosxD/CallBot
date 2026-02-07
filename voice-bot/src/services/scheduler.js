import cron from 'node-cron';
import twilio from 'twilio';
import { config } from '../config/config.js';
import { getNextClient, markAsCalled, getCallActive, setCallActive, getActiveService } from './dripService.js';
import logger from '../utils/logger.js';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startScheduler = () => {
  logger.info('Scheduler started');

  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const timeInMountain = new Date(now.toLocaleString("en-US", {timeZone: "America/Denver"}));
      const currentHour = timeInMountain.getHours();
      const currentMinute = timeInMountain.getMinutes();

      const isMorning = (currentHour === 9 && currentMinute >= 30) || (currentHour === 10) || (currentHour === 11 && currentMinute <= 30);
      const isAfternoon = (currentHour === 14 && currentMinute >= 30) || (currentHour === 15 && currentMinute <= 30);
      const isOperatingHours = isMorning || isAfternoon;

      if (getCallActive()) {
        if (!isOperatingHours) {
           logger.info('Scheduler: Active call outside operating hours. Terminating...');
           const service = getActiveService();
           if (service && typeof service.endCall === 'function') {
               service.endCall("I apologize, but I have to wrap up now. Can we continue this later?");
           } else {
               // Force reset if no service instance available (e.g. call setup phase)
               // setCallActive(false);
               // Actually, better to wait for status callback or timeout
           }
        } else {
           logger.info('Scheduler: Call already in progress. Skipping.');
        }
        return;
      }

      if (!isOperatingHours) {
        logger.info('Scheduler: Outside operating hours.');
        return;
      }

      const nextClient = await getNextClient();
      if (!nextClient) {
        logger.info('Scheduler: No pending clients found.');
        return;
      }

      logger.info(`Scheduler: Initiating call to ${nextClient.name} (${nextClient.phone})`);

      // Mark as CALLED immediately
      await markAsCalled(nextClient.id);

      // Set active flag to prevent double dialing
      setCallActive(true);

      // Initiate Call
      const call = await client.calls.create({
        url: `${config.server.publicUrl}/voice/inbound?clientId=${nextClient.id}`,
        to: nextClient.phone,
        from: config.twilio.phoneNumber,
        statusCallback: `${config.server.publicUrl}/voice/status`,
        statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
      });

      logger.info(`Call initiated: ${call.sid}`);

    } catch (error) {
      logger.error('Scheduler Error:', error);
      setCallActive(false); // Reset on error
    }
  });
};
