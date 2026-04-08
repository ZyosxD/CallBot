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

export const sendSuccessEmail = async (data, callerId) => {
  if (!config.email.toAddress) {
    logger.warn('No toAddress configured for emails. Skipping email.');
    return;
  }
  try {
    const { contactName, companyName, confirmedPhone, appointmentTime } = data;
    const phoneMatch = confirmedPhone === callerId ? 'MATCH' : 'DIFFERENT';

    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.smtpUser}>`,
      to: config.email.toAddress,
      subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
      text: `We have successfully scheduled a new Technical Assessment!

Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}

--- Phone Verification ---
Caller ID (Original): ${callerId}
Confirmed Phone (Verbal): ${confirmedPhone}
Status: ${phoneMatch}
--------------------------
`
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data, callerId) => {
  if (!config.email.toAddress) {
    logger.warn('No toAddress configured for emails. Skipping email.');
    return;
  }
  try {
    const { reason, summary } = data;

    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.smtpUser}>`,
      to: config.email.toAddress,
      subject: `🟠 REPORT: Interaction Update - ${callerId}`,
      text: `An interaction was completed without scheduling an appointment.

Reason: ${reason}
Summary: ${summary}

--- Phone Details ---
Caller ID: ${callerId}
---------------------
`
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
