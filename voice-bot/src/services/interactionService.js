import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const interactionsFilePath = path.join(__dirname, '..', '..', 'interactions.json');

export const reportInteraction = async (reason, callerId) => {
    try {
        const interaction = {
            id: Date.now().toString(),
            callerId: callerId,
            reason: reason,
            timestamp: new Date().toISOString()
        };

        let interactions = [];
        if (fs.existsSync(interactionsFilePath)) {
            const data = fs.readFileSync(interactionsFilePath, 'utf8');
            interactions = JSON.parse(data);
        }

        interactions.push(interaction);
        fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2), 'utf8');

        logger.info(`Interaction reported for ${callerId}: ${reason}`);

        // Trigger report email
        const subject = `🟠 REPORT: Interaction Logged - ${reason}`;
        const htmlContent = `
            <h2>Call Interaction Report</h2>
            <p><strong>Caller ID:</strong> ${callerId}</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p><strong>Timestamp:</strong> ${interaction.timestamp}</p>
        `;
        await sendEmail(subject, htmlContent);

        return { status: 'success', message: 'Interaction reported' };
    } catch (error) {
        logger.error('Error reporting interaction:', error);
        throw new Error('Failed to report interaction');
    }
};
