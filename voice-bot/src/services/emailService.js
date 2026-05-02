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

export const sendSuccessEmail = async (contactName, companyName, confirmedPhone, appointmentTime, callerId) => {
  try {
    const info = await transporter.sendMail({
      from: `"1Wire Sarah" <${config.email.smtpUser}>`,
      to: config.email.notificationEmail,
      subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
      text: `
A new Technical Assessment has been scheduled!

Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}

Phone Verification:
Confirmed Phone (verbal): ${confirmedPhone}
Caller ID (Twilio): ${callerId}
`,
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (callSid, reason, details, callerId) => {
  try {
    const info = await transporter.sendMail({
      from: `"1Wire Sarah" <${config.email.smtpUser}>`,
      to: config.email.notificationEmail,
      subject: `🟠 REPORT: Interaction Log - ${callSid}`,
      text: `
Interaction Report

Call SID: ${callSid}
Reason: ${reason}
Details: ${details}
Caller ID (Twilio): ${callerId}
`,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
