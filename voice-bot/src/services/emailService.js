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

export const sendReportEmail = async (type, data) => {
  try {
    const isSuccess = type === 'SUCCESS';
    const subject = isSuccess
      ? `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName || 'Unknown Company'}`
      : `🟠 REPORT: Interaction Logged - ${data.callerId || 'Unknown Caller'}`;

    let htmlContent = `
      <h2>${isSuccess ? 'New Technical Assessment Scheduled' : 'Interaction Report'}</h2>
      <p><strong>Caller ID (Twilio):</strong> ${data.callerId || 'N/A'}</p>
      <p><strong>Confirmed Phone (Verbal):</strong> ${data.confirmedPhone || 'N/A'}</p>
    `;

    if (isSuccess) {
      htmlContent += `
        <p><strong>Contact Name:</strong> ${data.contactName}</p>
        <p><strong>Company Name:</strong> ${data.companyName}</p>
        <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
        <p><strong>Notes/Needs:</strong> ${data.notes || 'None'}</p>
      `;
    } else {
      htmlContent += `
        <p><strong>Status/Outcome:</strong> ${data.outcome}</p>
        <p><strong>Summary:</strong> ${data.summary}</p>
      `;
    }

    const mailOptions = {
      from: config.email.smtpUser,
      to: config.email.notificationEmail,
      subject,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error(`Error sending email report: ${error.message}`);
  }
};
