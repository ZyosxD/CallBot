import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const interactionsFile = path.resolve('interactions.json');

export const reportInteraction = async (data) => {
    try {
        const { reason, notes, callSid, callerId } = data;

        const interaction = {
            id: Date.now(),
            reason,
            notes,
            callSid,
            callerId,
            timestamp: new Date().toISOString()
        };

        let interactions = [];
        if (fs.existsSync(interactionsFile)) {
            try {
                interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf-8'));
            } catch (e) {
                logger.error('Error parsing interactions.json:', e);
            }
        }

        interactions.push(interaction);
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

        logger.info(`Interaction reported for call ${callSid}: ${reason}`);

        // Trigger Report Email
        await sendReportEmail(interaction);

        return {
            success: true,
            message: 'Interaction successfully reported and logged.'
        };

    } catch (error) {
        logger.error('Error reporting interaction:', error);
        return {
            success: false,
            message: 'Failed to report interaction.'
        };
    }
};
