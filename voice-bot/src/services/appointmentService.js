import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendEmail } from './emailService.js';

const LEADS_FILE = path.join(process.cwd(), 'leads.json');

export const createAppointment = async (appointmentData, callerId) => {
    try {
        let leads = [];
        try {
            const data = await fs.readFile(LEADS_FILE, 'utf8');
            leads = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        const newLead = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            contactName: appointmentData.contactName,
            companyName: appointmentData.companyName,
            confirmedPhone: appointmentData.confirmedPhone,
            appointmentTime: appointmentData.appointmentTime,
            callerId: callerId
        };

        leads.push(newLead);
        await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));

        logger.info(`Appointment scheduled for ${newLead.companyName}`);

        // Send Email Report
        await sendEmail({
            subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
            text: `
A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${newLead.contactName}
- Company Name: ${newLead.companyName}
- Appointment Time: ${newLead.appointmentTime}

Phone Verification:
- Caller ID: ${newLead.callerId}
- Confirmed Phone: ${newLead.confirmedPhone}
            `
        });

        return { status: 'success', message: 'Technical Assessment scheduled successfully.' };
    } catch (error) {
        logger.error('Error creating appointment:', error);
        return { status: 'error', message: 'Failed to schedule appointment.' };
    }
};
