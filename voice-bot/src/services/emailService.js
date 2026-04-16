import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendSuccessEmail = async (callerId, details) => {
  const subject = `🟢 SUCCESS: Technical Assessment Scheduled with ${details.companyName}`;

  const text = `
Good news! An appointment has been scheduled.

Contact Name: ${details.contactName}
Company Name: ${details.companyName}
Appointment Time: ${details.appointmentTime}

Phone Comparison:
- Original Caller ID: ${callerId}
- Confirmed Phone: ${details.confirmedPhone}
`;

  try {
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      text
    });
    logger.info(`Success email sent for ${details.companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (callerId, details) => {
  const subject = `🟠 REPORT: Interaction Logged - ${details.reason}`;

  const text = `
An interaction was recorded.

Reason: ${details.reason}
Notes: ${details.notes || 'None'}

Phone Comparison:
- Original Caller ID: ${callerId}
`;

  try {
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      text
    });
    logger.info(`Report email sent for interaction reason: ${details.reason}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
