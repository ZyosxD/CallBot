import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (contactName, companyName, originalPhone, confirmedPhone, appointmentTime) => {
  try {
    const mailOptions = {
      from: `"Sarah (1Wire Assistant)" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟢 SUCCESS - Technical Assessment Scheduled - ${companyName}`,
      html: `
        <h2>Technical Assessment Scheduled</h2>
        <p><strong>Company:</strong> ${companyName}</p>
        <p><strong>Contact Name:</strong> ${contactName}</p>
        <p><strong>Original Caller ID:</strong> ${originalPhone}</p>
        <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (callerId, outcome, notes) => {
  try {
    const mailOptions = {
      from: `"Sarah (1Wire Assistant)" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟠 REPORT - Call Interaction - ${callerId}`,
      html: `
        <h2>Call Interaction Report</h2>
        <p><strong>Caller ID:</strong> ${callerId}</p>
        <p><strong>Outcome:</strong> ${outcome}</p>
        <p><strong>Notes:</strong> ${notes}</p>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
