import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

// Create a transporter using SMTP
const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: parseInt(config.email.port || '587', 10),
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (appointmentData, twilioCallerId) => {
  const { contactName, companyName, verifiedPhone, exactTime } = appointmentData;

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
    text: `
      Great news! A new Technical Assessment has been scheduled.

      Details:
      - Contact Name: ${contactName}
      - Company Name: ${companyName}
      - Time: ${exactTime}

      Phone Verification:
      - Verbally Confirmed Phone: ${verifiedPhone}
      - Original Caller ID (Twilio): ${twilioCallerId}
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reportData, twilioCallerId) => {
  const { reason } = reportData;

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: `🟠 REPORT: Call Interaction Logged`,
    text: `
      An interaction was logged that requires your attention.

      Details:
      - Reason: ${reason}

      Phone Data:
      - Original Caller ID (Twilio): ${twilioCallerId}
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
