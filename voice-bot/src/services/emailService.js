import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: {
    user: config.email.auth.user,
    pass: config.email.auth.pass
  }
});

export const sendSuccessEmail = async (data) => {
  try {
    const { contactName, companyName, confirmedPhone, callerId, appointmentTime } = data;
    const phoneMatch = confirmedPhone === callerId ? '✅ Matches Caller ID' : '⚠️ Differs from Caller ID';

    const mailOptions = {
      from: config.email.notifications.from,
      to: config.email.notifications.to,
      subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
      text: `
A new Technical Assessment has been scheduled!

Details:
- Company Name: ${companyName}
- Contact Name: ${contactName}
- Appointment Time: ${appointmentTime}

Phone Verification:
- Verbally Confirmed Phone: ${confirmedPhone}
- Original Caller ID: ${callerId}
- Status: ${phoneMatch}

Great job!
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Failed to send success email', error);
  }
};

export const sendReportEmail = async (data) => {
  try {
    const { callerId, reason, summary } = data;

    const mailOptions = {
      from: config.email.notifications.from,
      to: config.email.notifications.to,
      subject: `🟠 REPORT: Interaction Logged - ${callerId}`,
      text: `
An interaction was logged that did not result in an appointment.

Details:
- Caller ID: ${callerId}
- Reason: ${reason}
- Summary: ${summary}
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for ${callerId}`);
  } catch (error) {
    logger.error('Failed to send report email', error);
  }
};
