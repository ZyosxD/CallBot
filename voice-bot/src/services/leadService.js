import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');
const LEADS_FILE = path.join(process.cwd(), 'leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'interactions.json');

export const getNextPendingClient = () => {
    try {
        if (!fs.existsSync(CLIENTS_FILE)) {
            logger.error(`Clients file not found at ${CLIENTS_FILE}`);
            return null;
        }
        const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
        const clients = JSON.parse(data);
        return clients.find(c => c.status === 'PENDING');
    } catch (error) {
        logger.error('Error reading clients file:', error);
        return null;
    }
};

export const updateClientStatus = (phone, status) => {
    try {
        if (!fs.existsSync(CLIENTS_FILE)) {
            logger.error(`Clients file not found at ${CLIENTS_FILE}`);
            return false;
        }
        const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
        let clients = JSON.parse(data);
        const index = clients.findIndex(c => c.phone === phone);
        if (index !== -1) {
            clients[index].status = status;
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
            logger.info(`Updated client ${phone} status to ${status}`);
            return true;
        }
        logger.warn(`Client with phone ${phone} not found`);
        return false;
    } catch (error) {
        logger.error('Error updating client status:', error);
        return false;
    }
};

export const addLead = (leadData) => {
    try {
        let leads = [];
        if (fs.existsSync(LEADS_FILE)) {
             const data = fs.readFileSync(LEADS_FILE, 'utf8');
             leads = JSON.parse(data);
        }
        leads.push({ ...leadData, timestamp: new Date().toISOString() });
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
        logger.info(`New lead added for ${leadData.name || 'unknown'}`);
        return true;
    } catch (error) {
        logger.error('Error adding lead:', error);
        return false;
    }
};

export const logInteraction = (interactionData) => {
    try {
        let interactions = [];
        if (fs.existsSync(INTERACTIONS_FILE)) {
             const data = fs.readFileSync(INTERACTIONS_FILE, 'utf8');
             interactions = JSON.parse(data);
        }
        interactions.push({ ...interactionData, timestamp: new Date().toISOString() });
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
        logger.info(`Interaction logged for ${interactionData.phone || 'unknown'}`);
        return true;
    } catch (error) {
        logger.error('Error logging interaction:', error);
        return false;
    }
};
