import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port === 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (details, callerId) => {
  try {
    const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${details.companyName}`;
    const html = `
      <h2>New Technical Assessment Scheduled</h2>
      <p><strong>Contact Name:</strong> ${details.contactName}</p>
      <p><strong>Company Name:</strong> ${details.companyName}</p>
      <p><strong>Verified Phone:</strong> ${details.confirmedPhone}</p>
      <p><strong>Original Caller ID:</strong> ${callerId}</p>
      <p><strong>Phone Match:</strong> ${details.confirmedPhone === callerId ? 'Yes' : 'No'}</p>
      <p><strong>Appointment Time:</strong> ${details.appointmentTime}</p>
      <p><strong>Notes:</strong> ${details.notes || 'None'}</p>
    `;

    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      html,
    });
    logger.info('Success email sent.');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details, callerId) => {
  try {
    const subject = `🟠 REPORT: Interaction Logged - ${callerId}`;
    const html = `
      <h2>Call Interaction Report</h2>
      <p><strong>Caller ID:</strong> ${callerId}</p>
      <p><strong>Reason:</strong> ${details.reason}</p>
      <p><strong>Summary:</strong> ${details.summary}</p>
      <p><strong>Follow-up Action:</strong> ${details.action}</p>
    `;

    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      html,
    });
    logger.info('Report email sent.');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
