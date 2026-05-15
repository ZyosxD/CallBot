import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';

const LEADS_FILE = path.join(process.cwd(), 'leads.json');

export const scheduleAppointment = async (data, callerId) => {
  try {
    const { contactName, companyName, verifiedPhone, exactTime, notes } = data;

    // Validate the Trifecta + Exact Time
    if (!contactName || !companyName || !verifiedPhone || !exactTime) {
      throw new Error('Missing required Trifecta information for scheduling.');
    }

    const appointment = {
      id: Date.now(),
      contactName,
      companyName,
      verifiedPhone,
      callerId,
      exactTime,
      notes: notes || '',
      status: 'scheduled'
    };

    // Save to leads.json
    let leads = [];
    if (fs.existsSync(LEADS_FILE)) {
      const fileContent = fs.readFileSync(LEADS_FILE, 'utf-8');
      if (fileContent) {
        leads = JSON.parse(fileContent);
      }
    }
    leads.push(appointment);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

    logger.info(`Appointment created for ${contactName} from ${companyName} at ${exactTime}`);

    // Send Success Email
    await sendSuccessEmail(contactName, companyName, verifiedPhone, callerId, exactTime, notes);

    return {
      success: true,
      message: `Technical Assessment scheduled successfully. Thank you, ${contactName}. A specialist will reach out to you.`
    };

  } catch (error) {
    logger.error('Error creating appointment:', error);
    throw error;
  }
};
