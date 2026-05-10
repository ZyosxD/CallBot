import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTERACTIONS_FILE = path.join(__dirname, '../../interactions.json');

export const reportInteraction = async (details, callerId) => {
  try {
    let interactions = [];
    try {
      const data = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
      interactions = JSON.parse(data);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const newInteraction = {
      ...details,
      callerId,
      timestamp: new Date().toISOString()
    };

    interactions.push(newInteraction);
    await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

    logger.info(`Interaction reported for caller ${callerId}`);

    // Send orange report email
    await sendReportEmail(details, callerId);

    return { status: 'success', message: 'Interaction reported successfully' };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { status: 'error', message: error.message };
  }
};
