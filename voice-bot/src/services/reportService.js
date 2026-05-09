import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const interactionsFilePath = path.join(__dirname, '../../data/interactions.json');

export const reportInteraction = async (reportData) => {
  try {
    const { reason, originalCallerId, notes } = reportData;

    let interactions = [];
    try {
      const data = await fs.readFile(interactionsFilePath, 'utf8');
      interactions = JSON.parse(data);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error('Error reading interactions.json:', err);
      }
    }

    const newReport = {
      id: Date.now().toString(),
      reason,
      originalCallerId,
      notes,
      createdAt: new Date().toISOString()
    };

    interactions.push(newReport);
    await fs.writeFile(interactionsFilePath, JSON.stringify(interactions, null, 2));
    logger.info(`Interaction reported for ${originalCallerId || 'Unknown'} - Reason: ${reason}`);

    await sendReportEmail(newReport);

    return { success: true, message: 'Interaction reported successfully.' };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { success: false, message: 'Failed to report interaction.' };
  }
};