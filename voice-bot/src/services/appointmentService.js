import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const leadsFilePath = path.join(__dirname, '..', '..', 'leads.json');

export const createAppointment = async (appointmentData, callerId) => {
  try {
    const newLead = {
      id: Date.now().toString(),
      ...appointmentData,
      twilioCallerId: callerId,
      status: 'scheduled',
      createdAt: new Date().toISOString()
    };

    let leads = [];
    if (fs.existsSync(leadsFilePath)) {
      const data = fs.readFileSync(leadsFilePath, 'utf8');
      leads = JSON.parse(data);
    }

    leads.push(newLead);
    fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2), 'utf8');

    logger.info(`Appointment created for ${appointmentData.contactName} at ${appointmentData.exactTime}`);

    // Trigger success email
    const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${appointmentData.companyName}`;
    const htmlContent = `
        <h2>New Technical Assessment Scheduled</h2>
        <p><strong>Contact Name:</strong> ${appointmentData.contactName}</p>
        <p><strong>Company Name:</strong> ${appointmentData.companyName}</p>
        <p><strong>Verified Phone:</strong> ${appointmentData.verifiedPhone}</p>
        <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
        <p><strong>Exact Time:</strong> ${appointmentData.exactTime}</p>
    `;
    await sendEmail(subject, htmlContent);

    return { status: 'success', message: 'Appointment scheduled successfully', appointmentId: newLead.id };
  } catch (error) {
    logger.error('Error creating appointment:', error);
    throw new Error('Failed to create appointment');
  }
};
