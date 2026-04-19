import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort === 465,
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendReportEmail = async (subject, text) => {
  try {
    if (!config.email.smtpUser || !config.email.smtpPass) {
        logger.warn('SMTP credentials not configured. Skipping email send.');
        return;
    }
    const mailOptions = {
      from: config.email.fromAddress,
      to: config.email.toAddress,
      subject: subject,
      text: text,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const generateEmailSubject = (isSuccess) => {
    return isSuccess ? '🟢 SUCCESS: Technical Assessment Scheduled' : '🟠 REPORT: Interaction Logged';
}

export const generateEmailBody = (callerId, confirmedPhone, data, isSuccess) => {
    let body = `Details of the interaction:\n\n`;
    body += `Original Caller ID: ${callerId}\n`;
    body += `Verbally Confirmed Phone: ${confirmedPhone || 'N/A'}\n\n`;

    if (isSuccess) {
        body += `Contact Name: ${data.contactName}\n`;
        body += `Company Name: ${data.companyName}\n`;
        body += `Appointment Time: ${data.appointmentTime}\n`;
        body += `Notes: ${data.notes || 'None'}\n`;
    } else {
        body += `Reason: ${data.reason}\n`;
        body += `Notes: ${data.notes || 'None'}\n`;
    }

    return body;
};
