import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort === 465, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendSuccessEmail = async (details) => {
  const { originalPhone, confirmedPhone, contactName, companyName, appointmentTime } = details;

  const mailOptions = {
    from: `"1Wire Assistant" <${config.email.smtpUser}>`,
    to: config.email.notificationEmail,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
    text: `
      Great news! A new Technical Assessment has been scheduled.

      Details:
      - Company Name: ${companyName}
      - Contact Name: ${contactName}
      - Appointment Time: ${appointmentTime}
      - Original Caller ID (Twilio): ${originalPhone}
      - Verbally Confirmed Phone: ${confirmedPhone}

      Please follow up with the client.
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent.');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const { originalPhone, reason, summary } = details;

  const mailOptions = {
    from: `"1Wire Assistant" <${config.email.smtpUser}>`,
    to: config.email.notificationEmail,
    subject: `🟠 REPORT: Interaction Logged - ${originalPhone}`,
    text: `
      An interaction has been logged with a client.

      Details:
      - Original Caller ID (Twilio): ${originalPhone}
      - Reason/Status: ${reason}
      - Summary: ${summary}
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent.');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
