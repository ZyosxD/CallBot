import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const INTERACTIONS_FILE = path.join(process.cwd(), 'interactions.json');

export const reportInteraction = async (data, callerId) => {
  try {
    const { reason, notes } = data;

    const interaction = {
      id: Date.now(),
      reason,
      notes,
      callerId,
      createdAt: new Date().toISOString()
    };

    let interactions = [];
    try {
      const fileData = await fs.readFile(INTERACTIONS_FILE, 'utf8');
      interactions = JSON.parse(fileData);
    } catch (e) {
      // File doesn't exist or is invalid, create new array
    }

    interactions.push(interaction);
    await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

    logger.info(`Interaction reported: ${reason}`);

    // Send email without awaiting to not block
    sendReportEmail({
        notes: `Reason: ${reason}. Notes: ${notes}`
    }, callerId);

    return {
      success: true,
      message: 'Interaction reported successfully.'
    };

  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return {
      success: false,
      message: 'Failed to report interaction.'
    };
  }
};
