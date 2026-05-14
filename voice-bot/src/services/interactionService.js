import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const interactionsPath = path.resolve('interactions.json');

const ensureInteractionsFile = () => {
  if (!fs.existsSync(interactionsPath)) {
    fs.writeFileSync(interactionsPath, JSON.stringify([]));
  }
};

export const reportInteraction = async (data) => {
  try {
    ensureInteractionsFile();
    const interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf-8'));

    const interaction = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      ...data
    };

    interactions.push(interaction);
    fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

    logger.info(`Interaction reported: ${data.reason}`);

    await sendReportEmail(data);

    return { success: true, message: "Interaction logged successfully." };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { success: false, message: "Failed to log interaction." };
  }
};
