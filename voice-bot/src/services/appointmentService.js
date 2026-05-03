import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export const handleScheduleAppointment = async (args, callerId, callSid) => {
    try {
        const leadData = {
            ...args,
            callerId,
            callSid,
            timestamp: new Date().toISOString()
        };

        let leads = [];
        try {
            leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
        } catch (e) {
            // Ignore if file doesn't exist or is empty
        }
        leads.push(leadData);
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

        await sendReportEmail('SUCCESS', leadData);
        return { status: 'appointment_scheduled_successfully' };
    } catch (error) {
        logger.error('Error scheduling appointment:', error);
        return { status: 'error_scheduling_appointment' };
    }
};

export const handleReportInteraction = async (args, callerId, callSid) => {
    try {
        const interactionData = {
            ...args,
            callerId,
            callSid,
            timestamp: new Date().toISOString()
        };

        let interactions = [];
        try {
            interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
        } catch (e) {
            // Ignore if file doesn't exist or is empty
        }
        interactions.push(interactionData);
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

        await sendReportEmail('REPORT', interactionData);
        return { status: 'interaction_reported_successfully' };
    } catch (error) {
        logger.error('Error reporting interaction:', error);
        return { status: 'error_reporting_interaction' };
    }
};
