import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

export const reportInteraction = async (interactionData) => {
  try {
    let interactions = [];
    if (fs.existsSync(interactionsFilePath)) {
      const fileData = fs.readFileSync(interactionsFilePath, 'utf8');
      interactions = JSON.parse(fileData);
    }

    interactions.push(interactionData);
    fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2), 'utf8');

    await sendReportEmail(interactionData);

    return { success: true, message: "Interaction reported successfully." };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { success: false, error: "Failed to report interaction." };
  }
};
