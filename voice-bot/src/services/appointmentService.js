import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const LEADS_FILE = path.join(process.cwd(), 'leads.json');

export const createAppointment = async (data) => {
    try {
        const { contactName, companyName, verifiedPhone, exactTime, callSid, originalCallerId } = data;

        if (!contactName || !companyName || !verifiedPhone || !exactTime) {
            throw new Error("Missing required 'Trifecta' information for the appointment.");
        }

        const appointment = {
            id: Date.now(),
            contactName,
            companyName,
            verifiedPhone,
            exactTime,
            callSid,
            originalCallerId,
            createdAt: new Date().toISOString()
        };

        let leads = [];
        try {
            const fileData = await fs.readFile(LEADS_FILE, 'utf8');
            leads = JSON.parse(fileData);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('Error reading leads.json:', error);
            }
        }

        leads.push(appointment);
        await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));

        logger.info(`Appointment scheduled for ${contactName} from ${companyName}.`);

        // Fire and forget email
        sendSuccessEmail(appointment);

        return { status: 'success', appointment };
    } catch (error) {
        logger.error('Error creating appointment:', error);
        return { status: 'error', message: error.message };
    }
};

export const checkAvailability = async (date, time) => {
    // Legacy mock function from original
    return true;
};
