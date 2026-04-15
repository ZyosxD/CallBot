import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port == 465,
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (details) => {
  const { contactName, companyName, callerId, confirmedPhone, appointmentTime } = details;

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: `🟢 SUCCESS: New Appointment Scheduled for ${companyName}`,
    text: `
A new Technical Assessment has been scheduled!

Details:
Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}

Phone Verification:
Caller ID: ${callerId}
Confirmed Phone: ${confirmedPhone}
`,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent.');
  } catch (error) {
    logger.error('Failed to send success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const { callerId, reason, notes } = details;

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: `🟠 REPORT: Interaction logged for ${callerId}`,
    text: `
An interaction has been logged that requires attention or follows a specific status.

Details:
Caller ID: ${callerId}
Reason: ${reason}
Notes: ${notes || 'No additional notes provided.'}
`,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent.');
  } catch (error) {
    logger.error('Failed to send report email:', error);
  }
};
