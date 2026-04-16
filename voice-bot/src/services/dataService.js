import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

const readJsonFile = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    logger.error(`Error reading file ${filePath}:`, error);
    return [];
  }
};

const writeJsonFile = async (filePath, data) => {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    logger.error(`Error writing to file ${filePath}:`, error);
  }
};

export const getClients = async () => {
  return await readJsonFile(CLIENTS_FILE);
};

export const updateClientStatus = async (phoneNumber, status) => {
  const clients = await getClients();
  const index = clients.findIndex(c => c.phoneNumber === phoneNumber);

  if (index !== -1) {
    clients[index].status = status;
    await writeJsonFile(CLIENTS_FILE, clients);
    return true;
  }
  return false;
};

export const addLead = async (leadData) => {
  const leads = await readJsonFile(LEADS_FILE);
  leads.push({ ...leadData, createdAt: new Date().toISOString() });
  await writeJsonFile(LEADS_FILE, leads);
};

export const addInteraction = async (interactionData) => {
  const interactions = await readJsonFile(INTERACTIONS_FILE);
  interactions.push({ ...interactionData, createdAt: new Date().toISOString() });
  await writeJsonFile(INTERACTIONS_FILE, interactions);
};
