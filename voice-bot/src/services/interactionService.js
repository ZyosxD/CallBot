import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { sendEmail } from './emailService.js';

const interactionsFilePath = path.resolve('interactions.json');

if (!fs.existsSync(interactionsFilePath)) {
  fs.writeFileSync(interactionsFilePath, JSON.stringify([]));
}

export const reportInteraction = async (data) => {
  try {
    const interactions = JSON.parse(fs.readFileSync(interactionsFilePath, 'utf8'));

    const interaction = {
      ...data,
      timestamp: new Date().toISOString()
    };

    interactions.push(interaction);
    fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2));

    logger.info(`Interaction reported for caller ${data.callerId}: ${data.reason}`);

    // Send Orange Email
    await sendEmail({
      subject: `🟠 REPORT: Interaction with ${data.callerId}`,
      text: `Reason: ${data.reason}\nNotes: ${data.notes || 'None'}\nCaller ID: ${data.callerId}`
    });

    return { success: true };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { success: false, error: 'Failed to report interaction' };
  }
};
