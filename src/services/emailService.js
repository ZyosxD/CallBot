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

export const sendSuccessEmail = async (data) => {
  try {
    const { contactName, companyName, verifiedPhone, callerId, appointmentTime, notes } = data;
    const subject = `🟢 New Lead: ${companyName}`;
    const text = `
      New Technical Assessment Scheduled!

      Contact Name: ${contactName}
      Company: ${companyName}

      📞 Phone Verification:
      Twilio CallerID: ${callerId}
      Verified Phone: ${verifiedPhone}

      📅 Appointment Time: ${appointmentTime}

      📝 Notes:
      ${notes || 'N/A'}
    `;

    await transporter.sendMail({
      from: config.email.user,
      to: config.email.to,
      subject,
      text,
    });
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data) => {
  try {
    const { contactName, companyName, callerId, result, notes } = data;
    const subject = `🟠 Interaction Report: ${companyName || callerId}`;
    const text = `
      Interaction Report

      Contact Name: ${contactName || 'Unknown'}
      Company: ${companyName || 'Unknown'}
      CallerID: ${callerId}

      Result: ${result}

      📝 Notes:
      ${notes || 'N/A'}
    `;

    await transporter.sendMail({
      from: config.email.user,
      to: config.email.to,
      subject,
      text,
    });
    logger.info(`Report email sent for ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
