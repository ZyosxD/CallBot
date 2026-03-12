import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendEmailReport = async (type, details) => {
  if (!config.email.notificationEmail) {
    logger.warn('Notification email not configured. Skipping email report.');
    return;
  }

  try {
    let subject = '';
    let htmlContent = '';

    const callerIdStr = details.callerId ? `${details.callerId}` : 'Unknown';
    const confirmedPhoneStr = details.confirmedPhone ? `${details.confirmedPhone}` : 'Not Confirmed';

    if (type === 'SUCCESS') {
      subject = '🟢 SUCCESS: Technical Assessment Scheduled';
      htmlContent = `
        <h2>Technical Assessment Scheduled</h2>
        <p><strong>Contact Name:</strong> ${details.contactName}</p>
        <p><strong>Company Name:</strong> ${details.companyName}</p>
        <p><strong>Caller ID (Twilio):</strong> ${callerIdStr}</p>
        <p><strong>Confirmed Phone:</strong> ${confirmedPhoneStr}</p>
        <p><strong>Appointment Time:</strong> ${details.appointmentTime}</p>
        <p><strong>Notes:</strong> ${details.notes || 'N/A'}</p>
      `;
    } else if (type === 'REPORT') {
      subject = '🟠 REPORT: Interaction Logged';
      htmlContent = `
        <h2>Interaction Logged</h2>
        <p><strong>Outcome:</strong> ${details.outcome}</p>
        <p><strong>Caller ID (Twilio):</strong> ${callerIdStr}</p>
        <p><strong>Notes/Summary:</strong> ${details.notes || 'N/A'}</p>
      `;
    }

    const info = await transporter.sendMail({
      from: `"1Wire Sarah" <${config.smtp.user}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: htmlContent,
    });

    logger.info(`Email report sent (${type}): ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
