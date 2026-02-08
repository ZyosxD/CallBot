import cron from 'node-cron';
import { startDrip, stopDrip, checkAndResumeDrip } from './dripService.js';
import logger from '../utils/logger.js';

const TIMEZONE = 'America/Denver';

export const initScheduler = () => {
    logger.info('Initializing Scheduler');

    // Start Morning Shift 9:30 AM
    cron.schedule('30 9 * * *', () => {
        logger.info('Starting Morning Shift');
        startDrip();
    }, { timezone: TIMEZONE });

    // End Morning Shift 11:30 AM
    cron.schedule('30 11 * * *', () => {
        logger.info('Ending Morning Shift');
        stopDrip();
    }, { timezone: TIMEZONE });

    // Start Afternoon Shift 2:30 PM
    cron.schedule('30 14 * * *', () => {
        logger.info('Starting Afternoon Shift');
        startDrip();
    }, { timezone: TIMEZONE });

    // End Afternoon Shift 3:30 PM
    cron.schedule('30 15 * * *', () => {
        logger.info('Ending Afternoon Shift');
        stopDrip();
    }, { timezone: TIMEZONE });

    // Also check on startup if we are in window
    checkAndResumeDrip();
};
