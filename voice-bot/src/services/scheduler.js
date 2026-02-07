import cron from 'node-cron';
import logger from '../utils/logger.js';
import { getNextClient } from './dripService.js';
import { initiateOutboundCall } from '../controllers/callController.js';

// Simple lock to prevent multiple simultaneous calls
let isCallInProgress = false;

// Function to reset lock (can be called by controller when call ends)
export const setCallInProgress = (status) => {
    isCallInProgress = status;
    logger.info(`Call lock status updated: ${isCallInProgress}`);
};

const runDripLogic = async () => {
    if (isCallInProgress) {
        logger.debug('Skipping drip: Call in progress.');
        return;
    }

    try {
        const client = await getNextClient();
        if (client) {
            logger.info(`Initiating drip call to ${client.name} (${client.phone})`);
            setCallInProgress(true); // Lock immediately
            const success = await initiateOutboundCall(client);
            if (!success) {
                setCallInProgress(false); // Unlock if failed
            }
        } else {
            logger.debug('No pending clients for drip.');
        }
    } catch (error) {
        logger.error('Error in drip logic:', error);
        setCallInProgress(false);
    }
};

export const startScheduler = () => {
    logger.info('Starting Smart Drip Scheduler (Mountain Time)...');

    // Options for Mountain Time
    const cronOptions = {
        scheduled: true,
        timezone: "America/Denver"
    };

    // Morning Window: 9:30 - 11:30
    // 9:30 - 9:59
    cron.schedule('30-59 9 * * 1-5', runDripLogic, cronOptions);
    // 10:00 - 10:59
    cron.schedule('* 10 * * 1-5', runDripLogic, cronOptions);
    // 11:00 - 11:30
    cron.schedule('0-30 11 * * 1-5', runDripLogic, cronOptions);

    // Afternoon Window: 2:30 - 3:30 (14:30 - 15:30)
    // 14:30 - 14:59
    cron.schedule('30-59 14 * * 1-5', runDripLogic, cronOptions);
    // 15:00 - 15:30
    cron.schedule('0-30 15 * * 1-5', runDripLogic, cronOptions);

    logger.info('Scheduler initialized.');
};
