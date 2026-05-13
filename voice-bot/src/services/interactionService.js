import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const interactionsFile = path.resolve('interactions.json');

export const reportInteraction = async (data, callerId) => {
  try {
    const { status, summary } = data;

    if (!status || !summary) {
      throw new Error('Missing required information: status or summary');
    }

    const interaction = {
      id: Date.now(),
      status,
      summary,
      callerId,
      timestamp: new Date().toISOString()
    };

    let interactions = [];
    try {
      const fileData = await fs.readFile(interactionsFile, 'utf8');
      interactions = JSON.parse(fileData);
    } catch (e) {
      // If file doesn't exist or is empty, we start with an empty array
      interactions = [];
    }

    interactions.push(interaction);
    await fs.writeFile(interactionsFile, JSON.stringify(interactions, null, 2));

    logger.info(`Interaction reported with status: ${status}`);

    // Trigger report email
    await sendReportEmail(interaction, callerId);

    return {
      success: true,
      message: 'Interaction reported successfully.',
      interaction
    };

  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return {
      success: false,
      message: 'Failed to report interaction.'
    };
  }
};
