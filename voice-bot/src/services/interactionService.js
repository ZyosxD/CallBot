import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const interactionsFile = path.resolve('interactions.json');

export const reportInteraction = async (data, callerId) => {
  try {
    const { reason, notes } = data;

    const interaction = {
      id: Date.now(),
      reason,
      notes,
      callerId,
      timestamp: new Date().toISOString()
    };

    let interactions = [];
    if (fs.existsSync(interactionsFile)) {
      const fileData = fs.readFileSync(interactionsFile, 'utf8');
      if (fileData) {
        interactions = JSON.parse(fileData);
      }
    }

    interactions.push(interaction);
    fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2), 'utf8');

    logger.info(`Interaction logged for reason: ${reason}`);

    // Trigger report email
    await sendReportEmail(reason, notes, callerId);

    return {
      success: true,
      message: `Interaction logged successfully.`,
    };

  } catch (error) {
    logger.error('Error logging interaction:', error);
    return {
      success: false,
      message: 'Failed to log interaction.'
    };
  }
};