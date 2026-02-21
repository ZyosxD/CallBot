import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port == 465, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass
  }
});

export const sendEmail = async (type, data) => {
  try {
    let subject = '';
    let html = '';

    if (type === 'success') {
      subject = `🟢 NEW APPOINTMENT: ${data.companyName}`;
      html = `
        <h2>New Technical Assessment Scheduled</h2>
        <p><strong>Contact:</strong> ${data.contactName}</p>
        <p><strong>Company:</strong> ${data.companyName}</p>
        <p><strong>Phone (Confirmed):</strong> ${data.phoneNumber}</p>
        <p><strong>Original Caller ID:</strong> ${data.callerId}</p>
        <p><strong>Date/Time:</strong> ${data.dateTime}</p>
        <p><strong>Notes:</strong> ${data.notes || 'None'}</p>
      `;
    } else if (type === 'report') {
      subject = `🟠 CALL REPORT: ${data.outcome}`;
      html = `
        <h2>Call Outcome Report</h2>
        <p><strong>Outcome:</strong> ${data.outcome}</p>
        <p><strong>Original Caller ID:</strong> ${data.callerId}</p>
        <p><strong>Notes:</strong> ${data.notes}</p>
      `;
    }

    const info = await transporter.sendMail({
      from: '"Sarah (1Wire AI)" <' + config.smtp.user + '>',
      to: config.notificationEmail,
      subject: subject,
      html: html
    });

    logger.info(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
