import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendSuccessEmail = async (contactName, companyName, confirmedPhone, appointmentTime, callerId) => {
  const mailOptions = {
    from: config.email.fromEmail,
    to: config.email.toEmail,
    subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
    text: `
A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Confirmed Phone: ${confirmedPhone}
- Original Caller ID: ${callerId}
- Scheduled Time: ${appointmentTime}

(Caller ID matches confirmed phone: ${confirmedPhone === callerId ? 'Yes' : 'No'})
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reason, callerId) => {
  const mailOptions = {
    from: config.email.fromEmail,
    to: config.email.toEmail,
    subject: '🟠 REPORT: Call Interaction Logged',
    text: `
An interaction was logged without a scheduled assessment.

Details:
- Original Caller ID: ${callerId}
- Reason/Outcome: ${reason}
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
