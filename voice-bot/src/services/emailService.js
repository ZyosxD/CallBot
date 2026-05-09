import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // Use TLS or adjust based on your SMTP setup
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (data) => {
  try {
    const { contactName, companyName, verifiedPhone, exactTime, originalCallerId, notes } = data;

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: '🟢 SUCCESS: New Technical Assessment Scheduled!',
      text: `
A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Verified Phone: ${verifiedPhone}
- Original Caller ID: ${originalCallerId || 'N/A'}
- Exact Time: ${exactTime}
- Notes: ${notes || 'N/A'}

Caller ID vs Confirmed Phone Comparison:
Original: ${originalCallerId || 'N/A'}
Confirmed: ${verifiedPhone}
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data) => {
  try {
    const { reason, originalCallerId, notes } = data;

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: '🟠 REPORT: Interaction Update',
      text: `
An interaction report has been generated.

Details:
- Reason: ${reason}
- Original Caller ID: ${originalCallerId || 'N/A'}
- Notes: ${notes || 'N/A'}
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};