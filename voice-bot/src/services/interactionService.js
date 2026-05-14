import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const INTERACTIONS_FILE = path.join(process.cwd(), 'interactions.json');

export const reportInteraction = async (data) => {
  try {
    const { status, callerId, notes } = data;

    let interactions = [];
    try {
      const fileData = await fs.readFile(INTERACTIONS_FILE, 'utf8');
      if (fileData) {
        interactions = JSON.parse(fileData);
      }
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }

    const interactionData = {
      id: Date.now(),
      status,
      callerId,
      notes,
      timestamp: new Date().toISOString()
    };

    interactions.push(interactionData);
    await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2), 'utf8');

    logger.info(`Interaction reported with status: ${status} for callerId: ${callerId}`);

    await sendReportEmail(interactionData);

    return { success: true, message: 'Interaction reported successfully' };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { success: false, message: 'Failed to report interaction' };
  }
};
