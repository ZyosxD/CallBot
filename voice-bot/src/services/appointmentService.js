import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../../leads.json');

export const scheduleAppointment = async (appointmentData, twilioCallerId) => {
    try {
        let leads = [];
        if (fs.existsSync(LEADS_FILE)) {
            const data = fs.readFileSync(LEADS_FILE, 'utf8');
            leads = JSON.parse(data);
        }

        const newLead = {
            id: Date.now(),
            ...appointmentData, // contains contactName, companyName, verifiedPhone, appointmentTime
            twilioCallerId,
            timestamp: new Date().toISOString()
        };

        leads.push(newLead);
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

        logger.info(`Appointment scheduled: ${newLead.id}`);

        // Trigger email
        await sendSuccessEmail(appointmentData, twilioCallerId);

        return { success: true, message: "Appointment scheduled successfully." };
    } catch (error) {
        logger.error('Error scheduling appointment:', error);
        return { success: false, message: "Failed to schedule appointment." };
    }
};
