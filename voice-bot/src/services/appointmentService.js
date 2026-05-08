import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const LEADS_FILE = path.join(process.cwd(), 'leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'interactions.json');

export const schedule_appointment = async (args, callerId) => {
    logger.info(`Scheduling appointment with args: ${JSON.stringify(args)} and callerId: ${callerId}`);
    try {
        let leads = [];
        try {
            const data = await fs.readFile(LEADS_FILE, 'utf-8');
            leads = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        const newLead = {
            ...args,
            timestamp: new Date().toISOString(),
            callerId
        };
        leads.push(newLead);
        await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf-8');

        await sendSuccessEmail(args, callerId);

        return { status: 'success', message: 'Appointment scheduled and email sent.' };
    } catch (error) {
        logger.error('Error scheduling appointment:', error);
        return { status: 'error', message: 'Failed to schedule appointment.' };
    }
};

export const report_interaction = async (args, callerId) => {
    logger.info(`Reporting interaction with args: ${JSON.stringify(args)} and callerId: ${callerId}`);
    try {
        let interactions = [];
        try {
            const data = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
            interactions = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        const newInteraction = {
            ...args,
            timestamp: new Date().toISOString(),
            callerId
        };
        interactions.push(newInteraction);
        await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2), 'utf-8');

        await sendReportEmail(args, callerId);

        return { status: 'success', message: 'Interaction reported and email sent.' };
    } catch (error) {
        logger.error('Error reporting interaction:', error);
        return { status: 'error', message: 'Failed to report interaction.' };
    }
};
