import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: parseInt(config.email.port, 10) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (contactName, companyName, verifiedPhone, callerId, exactTime, notes) => {
  try {
    const info = await transporter.sendMail({
      from: `"Sarah 1Wire Assistant" <${config.email.from}>`,
      to: config.email.to,
      subject: "🟢 SUCCESS: New Technical Assessment Scheduled",
      text: `Great news! A new technical assessment has been scheduled.

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Verified Phone: ${verifiedPhone}
- Original Caller ID: ${callerId}
- Exact Time: ${exactTime}
- Notes: ${notes || 'None'}

Please follow up accordingly.`,
    });

    logger.info(`Success email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error("Error sending success email:", error);
    return false;
  }
};

export const sendReportEmail = async (outcome, callerId, notes) => {
  try {
    const info = await transporter.sendMail({
      from: `"Sarah 1Wire Assistant" <${config.email.from}>`,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction Update - ${outcome}`,
      text: `An interaction has been logged.

Details:
- Outcome: ${outcome}
- Caller ID: ${callerId}
- Notes: ${notes || 'None'}

Review the interactions log for more context if needed.`,
    });

    logger.info(`Report email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error("Error sending report email:", error);
    return false;
  }
};
