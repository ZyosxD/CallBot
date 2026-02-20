import cron from 'node-cron';
import { checkAndCall } from './dripService.js';
import logger from '../utils/logger.js';

export const startScheduler = () => {
  logger.info('Scheduler started (Mountain Time Checks).');

  // Check every minute.
  // checkAndCall handles logic to skip if busy or out of hours.
  cron.schedule('* * * * *', () => {
    checkAndCall();
  });
};
