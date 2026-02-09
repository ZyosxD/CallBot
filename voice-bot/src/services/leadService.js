import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');
const LEADS_FILE = path.join(process.cwd(), 'leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'interactions.json');

const readJson = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Error reading file ${filePath}: ${error.message}`);
    return [];
  }
};

const writeJson = async (filePath, data) => {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    logger.error(`Error writing file ${filePath}: ${error.message}`);
  }
};

export const getNextPendingClient = async () => {
  const clients = await readJson(CLIENTS_FILE);
  return clients.find(client => client.status === 'PENDING');
};

export const getClientById = async (id) => {
  const clients = await readJson(CLIENTS_FILE);
  // Use loose equality to handle string/number mismatch
  return clients.find(client => client.id == id);
};

export const updateClientStatus = async (id, status) => {
  const clients = await readJson(CLIENTS_FILE);
  const index = clients.findIndex(client => client.id == id);

  if (index !== -1) {
    clients[index].status = status;
    if (status === 'CALLED') {
      clients[index].attempts = (clients[index].attempts || 0) + 1;
      clients[index].lastCalled = new Date().toISOString();
    }
    await writeJson(CLIENTS_FILE, clients);
    return clients[index];
  }
  return null;
};

export const saveLead = async (leadData) => {
  const leads = await readJson(LEADS_FILE);
  leads.push({
    ...leadData,
    timestamp: new Date().toISOString()
  });
  await writeJson(LEADS_FILE, leads);

  // Also update client status if clientId is present
  if (leadData.clientId) {
    await updateClientStatus(leadData.clientId, 'CONVERTED');
  }
};

export const logInteraction = async (interactionData) => {
  const interactions = await readJson(INTERACTIONS_FILE);
  interactions.push({
    ...interactionData,
    timestamp: new Date().toISOString()
  });
  await writeJson(INTERACTIONS_FILE, interactions);
};
