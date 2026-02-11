import cron from 'node-cron';
import { startDrip, stopDrip } from './dripService.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const TIMEZONE = 'America/Denver';

export const startScheduler = () => {
  logger.info('Initializing scheduler...');

  // Morning Start: 9:30 AM Mon-Fri
  cron.schedule('30 9 * * 1-5', () => {
    logger.info('Scheduler: Starting morning session.');
    startDrip();
  }, { timezone: TIMEZONE });

  // Morning End: 11:30 AM Mon-Fri
  cron.schedule('30 11 * * 1-5', () => {
    logger.info('Scheduler: Ending morning session.');
    stopDrip();
  }, { timezone: TIMEZONE });

  // Afternoon Start: 2:30 PM Mon-Fri (14:30)
  cron.schedule('30 14 * * 1-5', () => {
    logger.info('Scheduler: Starting afternoon session.');
    startDrip();
  }, { timezone: TIMEZONE });

  // Afternoon End: 3:30 PM Mon-Fri (15:30)
  cron.schedule('30 15 * * 1-5', () => {
    logger.info('Scheduler: Ending afternoon session.');
    stopDrip();
  }, { timezone: TIMEZONE });

  // Check immediately on startup
  checkImmediateStart();
};

const checkImmediateStart = () => {
  // Simple check if we are within operating hours
  // We can reuse the logic in dripService or just implement it here
  // Actually, dripService logic is better encapsulated there but we need to call startDrip
  // startDrip will check operating hours internally? No, I implemented checkOperatingHours inside makeNextCall.
  // So startDrip -> makeNextCall -> checkOperatingHours.
  // So calling startDrip is safe, it will just log and return if outside hours.

  logger.info('Checking if current time is within operating hours...');
  startDrip();
};
