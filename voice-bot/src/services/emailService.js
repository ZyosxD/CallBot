import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendSuccessEmail = async (contactName, companyName, callerId, confirmedPhone, appointmentTime) => {
  const subject = `🟢 SUCCESS: Technical Assessment Scheduled for ${companyName}`;
  const text = `
We have successfully scheduled a Technical Assessment!

Company: ${companyName}
Contact Name: ${contactName}
Appointment Time: ${appointmentTime}

--- Phone Verification ---
Original Caller ID: ${callerId}
Verbally Confirmed Phone: ${confirmedPhone}
`;

  try {
    await transporter.sendMail({
      from: config.smtp.user,
      to: config.notificationEmail,
      subject,
      text,
    });
    logger.info(`Success email sent for lead: ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (callerId, reason, notes) => {
  const subject = `🟠 REPORT: Interaction outcome logged`;
  const text = `
An interaction has been logged.

Original Caller ID: ${callerId}
Outcome/Reason: ${reason}
Notes: ${notes}
`;

  try {
    await transporter.sendMail({
      from: config.smtp.user,
      to: config.notificationEmail,
      subject,
      text,
    });
    logger.info(`Report email sent for callerId: ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
