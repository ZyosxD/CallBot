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

export const sendSuccessEmail = async (data) => {
  try {
    const info = await transporter.sendMail({
      from: `"Sarah 1Wire" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName}`,
      html: `
        <h2>Technical Assessment Scheduled</h2>
        <p><strong>Contact Name:</strong> ${data.contactName}</p>
        <p><strong>Company Name:</strong> ${data.companyName}</p>
        <p><strong>Confirmed Phone:</strong> ${data.confirmedPhone}</p>
        <p><strong>Original Caller ID:</strong> ${data.callerId}</p>
        <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
        <br>
        <p><strong>Notes:</strong> ${data.notes || ''}</p>
      `,
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data) => {
  try {
    const info = await transporter.sendMail({
      from: `"Sarah 1Wire" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction Logged - ${data.reason}`,
      html: `
        <h2>Interaction Report</h2>
        <p><strong>Reason:</strong> ${data.reason}</p>
        <p><strong>Original Caller ID:</strong> ${data.callerId}</p>
        <br>
        <p><strong>Notes/Summary:</strong> ${data.notes || ''}</p>
      `,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
