import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email && config.email.host) {
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure, // true for 465, false for other ports
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });
}

export const sendSuccessEmail = async (leadData) => {
  if (!transporter) {
    logger.warn('Email service not configured, skipping sendSuccessEmail');
    return;
  }

  const mailOptions = {
    from: `"1Wire Assistant" <${config.email.user}>`,
    to: config.email.notificationAddress,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${leadData.companyName}`,
    text: `
A new Technical Assessment has been scheduled!

Details:
-----------------------------------------
Contact Name: ${leadData.contactName}
Company Name: ${leadData.companyName}
Appointment Time: ${leadData.appointmentTime}

Phone Verification:
Original Caller ID (Twilio): ${leadData.originalCallerId}
Verbally Confirmed Phone: ${leadData.confirmedPhone}
-----------------------------------------

Timestamp: ${leadData.timestamp}
Call SID: ${leadData.callSid}
`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData) => {
  if (!transporter) {
    logger.warn('Email service not configured, skipping sendReportEmail');
    return;
  }

  const mailOptions = {
    from: `"1Wire Assistant" <${config.email.user}>`,
    to: config.email.notificationAddress,
    subject: `🟠 REPORT: Interaction Logged (${interactionData.reason})`,
    text: `
An interaction was logged.

Details:
-----------------------------------------
Reason: ${interactionData.reason}
Notes: ${interactionData.notes || 'N/A'}

Phone Verification:
Original Caller ID (Twilio): ${interactionData.originalCallerId}
-----------------------------------------

Timestamp: ${interactionData.timestamp}
Call SID: ${interactionData.callSid}
`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
