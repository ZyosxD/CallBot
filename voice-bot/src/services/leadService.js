import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

const LEADS_FILE = path.join(process.cwd(), 'leads.json');

export const saveLead = (leadData) => {
  try {
    let leads = [];
    if (fs.existsSync(LEADS_FILE)) {
      const data = fs.readFileSync(LEADS_FILE, 'utf8');
      leads = JSON.parse(data);
    }
    leads.push({
      ...leadData,
      createdAt: new Date().toISOString()
    });
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    logger.info('Lead saved to leads.json successfully.');
  } catch (error) {
    logger.error('Error saving to leads.json:', error);
  }
};
