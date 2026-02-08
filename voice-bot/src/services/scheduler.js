import cron from 'node-cron';
import { dripService } from './dripService.js';
import logger from '../utils/logger.js';

const TIMEZONE = 'America/Denver';

export const startScheduler = () => {
  logger.info('Initializing scheduler with timezone: ' + TIMEZONE);

  // Check if currently within operating hours on startup
  if (dripService.isWithinOperatingHours()) {
      logger.info('Scheduler: Currently within operating hours. Starting drip immediately.');
      dripService.start();
  }

  // Morning Session Start: 9:30 AM
  cron.schedule('30 9 * * *', () => {
    logger.info('Scheduler: Starting morning session');
    dripService.start();
  }, { timezone: TIMEZONE });

  // Morning Session End: 11:30 AM
  cron.schedule('30 11 * * *', () => {
    logger.info('Scheduler: Ending morning session');
    dripService.stop();
  }, { timezone: TIMEZONE });

  // Afternoon Session Start: 2:30 PM (14:30)
  cron.schedule('30 14 * * *', () => {
    logger.info('Scheduler: Starting afternoon session');
    dripService.start();
  }, { timezone: TIMEZONE });

  // Afternoon Session End: 3:30 PM (15:30)
  cron.schedule('30 15 * * *', () => {
    logger.info('Scheduler: Ending afternoon session');
    dripService.stop();
  }, { timezone: TIMEZONE });
};
