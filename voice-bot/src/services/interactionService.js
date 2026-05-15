import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const INTERACTIONS_FILE = path.join(process.cwd(), 'interactions.json');

export const reportInteraction = async (data) => {
    try {
        const { reason, details, callSid, originalCallerId } = data;

        const interaction = {
            id: Date.now(),
            reason,
            details,
            callSid,
            originalCallerId,
            createdAt: new Date().toISOString()
        };

        let interactions = [];
        try {
            const fileData = await fs.readFile(INTERACTIONS_FILE, 'utf8');
            interactions = JSON.parse(fileData);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('Error reading interactions.json:', error);
            }
        }

        interactions.push(interaction);
        await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

        logger.info(`Interaction reported for reason: ${reason}.`);

        // Fire and forget email
        sendReportEmail(interaction);

        return { status: 'success', interaction };
    } catch (error) {
        logger.error('Error reporting interaction:', error);
        return { status: 'error', message: error.message };
    }
};
