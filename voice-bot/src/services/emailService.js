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

export const sendSuccessEmail = async (data) => {
  try {
    const { contactName, companyName, confirmedPhone, callerId, appointmentTime, needs } = data;

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
      text: `
A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Scheduled Time: ${appointmentTime}

Phone Verification:
- Twilio CallerID: ${callerId || 'Unknown'}
- Verbally Confirmed Phone: ${confirmedPhone}
- Match: ${callerId === confirmedPhone ? 'Yes' : 'No'}

Detected Needs/Notes:
${needs || 'None specified'}
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data) => {
  try {
    const { reason, callerId, notes } = data;

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction Logged - ${callerId || 'Unknown'}`,
      text: `
An interaction has been logged that requires attention or tracking.

Details:
- Caller ID: ${callerId || 'Unknown'}
- Reason: ${reason}

Notes/Context:
${notes || 'No additional context provided.'}
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
