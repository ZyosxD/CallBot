import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { sendEmail } from './emailService.js';

const leadsFilePath = path.resolve('leads.json');

if (!fs.existsSync(leadsFilePath)) {
  fs.writeFileSync(leadsFilePath, JSON.stringify([]));
}

export const createAppointment = async (data) => {
  try {
    const leads = JSON.parse(fs.readFileSync(leadsFilePath, 'utf8'));

    const appointment = {
      ...data,
      timestamp: new Date().toISOString()
    };

    leads.push(appointment);
    fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2));

    logger.info(`Appointment scheduled for ${data.contactName} at ${data.companyName}`);

    // Send Green Email
    await sendEmail({
      subject: `🟢 SUCCESS: Technical Assessment Scheduled for ${data.companyName}`,
      text: `Appointment Details:\n
Contact Name: ${data.contactName}
Company Name: ${data.companyName}
Verified Phone: ${data.verifiedPhone}
Twilio Caller ID: ${data.callerId}
Match: ${data.verifiedPhone === data.callerId ? 'YES' : 'NO - DIFFERENT NUMBER'}
Exact Time: ${data.exactTime}`
    });

    return { success: true };
  } catch (error) {
    logger.error('Error creating appointment:', error);
    return { success: false, error: 'Failed to create appointment' };
  }
};

export const checkAvailability = async (date, time) => {
    return true; // Simplified for now
}
