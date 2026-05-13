import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (contactName, companyName, verifiedPhone, exactTime, callerId) => {
  try {
    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
      text: `A new appointment has been scheduled.

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Exact Time: ${exactTime}

Phone Verification:
- Verified Phone: ${verifiedPhone}
- Original Caller ID: ${callerId}`,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reason, notes, callerId) => {
  try {
    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: '🟠 REPORT: Interaction Logged',
      text: `An interaction was logged but no appointment was scheduled.

Details:
- Reason: ${reason}
- Notes: ${notes}
- Original Caller ID: ${callerId}`,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};