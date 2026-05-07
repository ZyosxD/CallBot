import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendEmail } from './emailService.js';

const INTERACTIONS_FILE = path.join(process.cwd(), 'interactions.json');

export const logInteraction = async (interactionData, callerId) => {
    try {
        let interactions = [];
        try {
            const data = await fs.readFile(INTERACTIONS_FILE, 'utf8');
            interactions = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        const newInteraction = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            reason: interactionData.reason,
            details: interactionData.details || 'No additional details provided.',
            callerId: callerId
        };

        interactions.push(newInteraction);
        await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

        logger.info(`Interaction logged: ${newInteraction.reason}`);

        // Send Email Report
        await sendEmail({
            subject: '🟠 REPORT: Interaction Logged',
            text: `
An interaction has been logged that did not result in an appointment.

Reason: ${newInteraction.reason}
Details: ${newInteraction.details}

Phone Context:
- Caller ID: ${newInteraction.callerId}
            `
        });

        return { status: 'success', message: 'Interaction logged successfully.' };
    } catch (error) {
        logger.error('Error logging interaction:', error);
        return { status: 'error', message: 'Failed to log interaction.' };
    }
};
