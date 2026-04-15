import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  service: config.email.service,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendSuccessEmail = async (contactName, companyName, confirmedPhone, callerId, appointmentTime, needs) => {
  const subject = `🟢 SUCCESS: Appointment scheduled with ${companyName}`;

  const text = `
New Technical Assessment Scheduled!

Contact Details:
- Name: ${contactName}
- Company: ${companyName}
- Confirmed Phone: ${confirmedPhone}
- Original Caller ID: ${callerId}
- Scheduled Time: ${appointmentTime}

Detected Needs: ${needs || 'Not specified'}

(Phone Match: ${confirmedPhone === callerId ? 'Yes' : 'No - verified different number'})
`;

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: config.email.to,
      subject,
      text
    });
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionType, details, confirmedPhone, callerId) => {
  const subject = `🟠 REPORT: ${interactionType} Interaction`;

  const text = `
Interaction Report

Type: ${interactionType}
Details: ${details}
Confirmed Phone: ${confirmedPhone || 'N/A'}
Original Caller ID: ${callerId}

(Phone Match: ${confirmedPhone === callerId ? 'Yes' : 'No - verified different number'})
`;

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: config.email.to,
      subject,
      text
    });
    logger.info(`Report email sent for type: ${interactionType}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};