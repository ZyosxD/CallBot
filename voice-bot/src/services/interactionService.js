import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTERACTIONS_FILE = path.join(__dirname, '../../interactions.json');

export const reportInteraction = async (interactionData, twilioCallerId) => {
    try {
        let interactions = [];
        if (fs.existsSync(INTERACTIONS_FILE)) {
            const data = fs.readFileSync(INTERACTIONS_FILE, 'utf8');
            interactions = JSON.parse(data);
        }

        const newInteraction = {
            id: Date.now(),
            ...interactionData,
            twilioCallerId,
            timestamp: new Date().toISOString()
        };

        interactions.push(newInteraction);
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

        logger.info(`Interaction logged: ${newInteraction.id}`);

        // Trigger email
        await sendReportEmail(interactionData, twilioCallerId);

        return { success: true, message: "Interaction reported successfully." };
    } catch (error) {
        logger.error('Error reporting interaction:', error);
        return { success: false, message: "Failed to report interaction." };
    }
};
