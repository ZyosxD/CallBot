import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort == 465, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendSuccessEmail = async (details) => {
  const { contactName, companyName, confirmedPhone, appointmentTime, callerId, notes } = details;

  const mailOptions = {
    from: `"Sarah AI" <${config.email.smtpUser}>`,
    to: config.email.notificationEmail,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
    text: `
We've successfully scheduled a Technical Assessment!

Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}
Confirmed Phone: ${confirmedPhone}
Twilio Caller ID: ${callerId}
Phone Match: ${confirmedPhone === callerId ? 'Yes ✅' : 'No ❌'}

Notes / Needs Detected:
${notes || 'N/A'}
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending Success Email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const { callerId, outcome, notes } = details;

  const mailOptions = {
    from: `"Sarah AI" <${config.email.smtpUser}>`,
    to: config.email.notificationEmail,
    subject: `🟠 REPORT: Interaction Logged - ${callerId}`,
    text: `
An interaction has concluded.

Twilio Caller ID: ${callerId}
Outcome: ${outcome}

Notes:
${notes || 'N/A'}
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending Report Email:', error);
  }
};
