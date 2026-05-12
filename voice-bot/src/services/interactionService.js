import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const interactionsFile = path.resolve('interactions.json');

export const reportInteraction = async (data) => {
  try {
    let interactions = [];
    try {
      const fileContent = await fs.readFile(interactionsFile, 'utf8');
      interactions = JSON.parse(fileContent);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const newInteraction = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      ...data,
    };

    interactions.push(newInteraction);
    await fs.writeFile(interactionsFile, JSON.stringify(interactions, null, 2));

    logger.info(`Interaction reported: ${data.reason}`);

    // Send report email
    await sendReportEmail(data);

    return { success: true, message: 'Interaction logged successfully.' };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { success: false, message: 'Failed to log interaction.' };
  }
};
