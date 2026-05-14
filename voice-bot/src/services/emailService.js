import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (details) => {
  const { contactName, companyName, verifiedPhone, exactTime, originalCallerId } = details;

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟢 SUCCESS: Technical Assessment Scheduled',
    text: `
      Great news! A new Technical Assessment has been scheduled.

      Contact Name: ${contactName}
      Company Name: ${companyName}
      Exact Time: ${exactTime}

      Phone Verification:
      Verbal Confirmed Phone: ${verifiedPhone}
      Original Caller ID: ${originalCallerId}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${contactName} at ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const { reason, verifiedPhone, originalCallerId } = details;

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟠 REPORT: Call Interaction Logged',
    text: `
      Interaction logged without scheduling.

      Reason: ${reason}

      Phone Details:
      Verified Phone: ${verifiedPhone || 'Not provided'}
      Original Caller ID: ${originalCallerId}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for reason: ${reason}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
