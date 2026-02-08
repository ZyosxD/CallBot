import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');

const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');

const readJson = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Error reading file ${filePath}:`, error);
    return [];
  }
};

const writeJson = async (filePath, data) => {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.error(`Error writing file ${filePath}:`, error);
  }
};

export const getNextPendingClient = async () => {
  const clients = await readJson(CLIENTS_FILE);
  return clients.find(client => client.status === 'PENDING');
};

export const updateClientStatus = async (id, status) => {
  const clients = await readJson(CLIENTS_FILE);
  const clientIndex = clients.findIndex(c => c.id == id);
  if (clientIndex !== -1) {
    clients[clientIndex].status = status;
    await writeJson(CLIENTS_FILE, clients);
    return clients[clientIndex];
  }
  return null;
};

export const getClientById = async (id) => {
    const clients = await readJson(CLIENTS_FILE);
    return clients.find(c => c.id == id);
};

export const addLead = async (leadData) => {
  const leads = await readJson(LEADS_FILE);
  leads.push({ ...leadData, timestamp: new Date().toISOString() });
  await writeJson(LEADS_FILE, leads);
};

export const logInteraction = async (interactionData) => {
  const interactions = await readJson(INTERACTIONS_FILE);
  interactions.push({ ...interactionData, timestamp: new Date().toISOString() });
  await writeJson(INTERACTIONS_FILE, interactions);
};
