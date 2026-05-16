import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const interactionsFilePath = path.join(__dirname, '../../interactions.json');

export const reportInteraction = async (interactionData) => {
  try {
    let interactions = [];
    try {
      const data = await fs.readFile(interactionsFilePath, 'utf8');
      interactions = JSON.parse(data);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    const newInteraction = {
      ...interactionData,
      timestamp: new Date().toISOString(),
    };

    interactions.push(newInteraction);
    await fs.writeFile(interactionsFilePath, JSON.stringify(interactions, null, 2));

    logger.info(`Interaction logged for reason: ${interactionData.reason}`);

    await sendReportEmail(interactionData);

    return { success: true, message: 'Interaction reported successfully' };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    throw error;
  }
};
