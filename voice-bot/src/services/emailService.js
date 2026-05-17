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

export const sendSuccessEmail = async (appointmentData) => {
  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: '🟢 SUCCESS: New Technical Assessment Scheduled!',
      text: `
We have successfully scheduled a new Technical Assessment!

DETAILS:
- Contact Name: ${appointmentData.contactName}
- Company Name: ${appointmentData.companyName}
- Verified Phone: ${appointmentData.verifiedPhone}
- Original Twilio Caller ID: ${appointmentData.originalCallerId}
- Appointment Time: ${appointmentData.appointmentTime}

Phone Match Status: ${appointmentData.verifiedPhone === appointmentData.originalCallerId ? 'Matched' : 'Different (Please update records)'}

Please ensure a specialist calls them at the specified time.
      `
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData) => {
  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: '🟠 REPORT: Interaction Logged',
      text: `
An interaction has been logged. The client was not interested, asked to call back, or it was a voicemail.

DETAILS:
- Outcome: ${interactionData.outcome}
- Summary: ${interactionData.summary}
- Original Twilio Caller ID: ${interactionData.originalCallerId}

Please review the logs for more information if needed.
      `
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
