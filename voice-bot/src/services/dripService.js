import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../../clients.json');
const LEADS_FILE = path.join(__dirname, '../../leads.json');

let activeCall = {
    isActive: false,
    service: null, // OpenAIRealtimeService instance
    startTime: null
};

export const setCallActive = (isActive, service = null) => {
  activeCall.isActive = isActive;
  activeCall.service = service;
  activeCall.startTime = isActive ? new Date() : null;
  logger.info(`Call active status set to: ${isActive}`);
};

export const getCallActive = () => {
  return activeCall.isActive;
};

export const getActiveService = () => {
    return activeCall.service;
};

export const getNextClient = async () => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);
    const client = clients.find(c => c.status === 'PENDING');
    return client || null;
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return null;
  }
};

export const getClientById = async (clientId) => {
    try {
        const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
        const clients = JSON.parse(data);
        const client = clients.find(c => c.id === clientId);
        return client || null;
    } catch (error) {
        logger.error('Error reading clients file:', error);
        return null;
    }
};

export const markAsCalled = async (clientId) => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    let clients = JSON.parse(data);
    const index = clients.findIndex(c => c.id === clientId);

    if (index !== -1) {
      clients[index].status = 'CALLED';
      await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
      logger.info(`Client ${clientId} marked as CALLED`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Error updating client status:', error);
    return false;
  }
};

export const updateClientStatus = async (clientId, status) => {
    try {
        const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
        let clients = JSON.parse(data);
        const index = clients.findIndex(c => c.id === clientId);

        if (index !== -1) {
          clients[index].status = status;
          await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
          logger.info(`Client ${clientId} status updated to ${status}`);
          return true;
        }
        return false;
      } catch (error) {
        logger.error('Error updating client status:', error);
        return false;
      }
}

export const addLead = async (leadData) => {
  try {
    let leads = [];
    try {
      const data = await fs.readFile(LEADS_FILE, 'utf-8');
      leads = JSON.parse(data);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    leads.push(leadData);
    await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));
    logger.info(`Lead added for ${leadData.companyName}`);
    return true;
  } catch (error) {
    logger.error('Error adding lead:', error);
    return false;
  }
};
