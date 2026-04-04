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

export const sendSuccessEmail = async (appointmentData, callerId) => {
  const mailOptions = {
    from: config.email.fromEmail,
    to: config.email.toEmail,
    subject: `🟢 SUCCESS - Technical Assessment Scheduled - ${appointmentData.companyName}`,
    text: `
A new Technical Assessment has been scheduled!

Details:
Contact Name: ${appointmentData.contactName}
Company Name: ${appointmentData.companyName}
Scheduled Time: ${appointmentData.appointmentTime}

Phone Comparison:
Original Caller ID (Twilio): ${callerId}
Verbally Confirmed Phone: ${appointmentData.confirmedPhone}
`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData, callerId) => {
  const mailOptions = {
    from: config.email.fromEmail,
    to: config.email.toEmail,
    subject: `🟠 REPORT - Interaction Logged - ${callerId}`,
    text: `
An interaction has been logged that requires review (Not Interested / Voicemail / Call Back).

Details:
Original Caller ID (Twilio): ${callerId}
Status/Outcome: ${interactionData.outcome}
Summary: ${interactionData.summary || 'No additional summary provided.'}
`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
