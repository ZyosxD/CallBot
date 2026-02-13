import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');

async function readJson(file) {
  try {
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${file}:`, error);
    return [];
  }
}

async function writeJson(file, data) {
  try {
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing ${file}:`, error);
  }
}

export const getNextPendingClient = async () => {
  const clients = await readJson(CLIENTS_FILE);
  return clients.find(c => c.status === 'PENDING');
};

export const getClientById = async (id) => {
  const clients = await readJson(CLIENTS_FILE);
  return clients.find(c => c.id == id);
};

export const updateClientStatus = async (id, status) => {
  const clients = await readJson(CLIENTS_FILE);
  const index = clients.findIndex(c => c.id == id);
  if (index !== -1) {
    clients[index].status = status;
    await writeJson(CLIENTS_FILE, clients);
    return clients[index];
  }
  return null;
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
