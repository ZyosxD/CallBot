import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';

const INTERACTIONS_FILE = path.join(process.cwd(), 'interactions.json');

export const reportInteraction = async (data, callerId) => {
  try {
    const { outcome, notes } = data;

    if (!outcome) {
      throw new Error('Missing required outcome for reporting interaction.');
    }

    const interaction = {
      id: Date.now(),
      outcome,
      callerId,
      notes: notes || '',
      timestamp: new Date().toISOString()
    };

    // Save to interactions.json
    let interactions = [];
    if (fs.existsSync(INTERACTIONS_FILE)) {
      const fileContent = fs.readFileSync(INTERACTIONS_FILE, 'utf-8');
      if (fileContent) {
        interactions = JSON.parse(fileContent);
      }
    }
    interactions.push(interaction);
    fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

    logger.info(`Interaction reported for ${callerId} with outcome: ${outcome}`);

    // Send Report Email
    await sendReportEmail(outcome, callerId, notes);

    return {
      success: true,
      message: `Interaction recorded successfully.`
    };

  } catch (error) {
    logger.error('Error reporting interaction:', error);
    throw error;
  }
};
