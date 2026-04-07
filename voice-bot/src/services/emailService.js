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

export const sendSuccessEmail = async (leadData, callerId) => {
  try {
    const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${leadData.companyName}`;
    const html = `
      <h2>New Technical Assessment Scheduled</h2>
      <p><strong>Contact Name:</strong> ${leadData.contactName}</p>
      <p><strong>Company Name:</strong> ${leadData.companyName}</p>
      <p><strong>Appointment Time:</strong> ${leadData.appointmentTime}</p>
      <h3>Phone Verification</h3>
      <p><strong>Caller ID (Twilio):</strong> ${callerId}</p>
      <p><strong>Verbally Confirmed Phone:</strong> ${leadData.confirmedPhone}</p>
      ${callerId !== leadData.confirmedPhone ? '<p style="color:red;"><em>Note: Verbally confirmed phone differs from Caller ID.</em></p>' : ''}
    `;

    await transporter.sendMail({
      from: config.email.user,
      to: config.email.to,
      subject,
      html,
    });
    logger.info(`Success email sent for ${leadData.companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reportData, callerId) => {
  try {
    const subject = `🟠 REPORT: Interaction Logged - ${callerId}`;
    const html = `
      <h2>Call Interaction Report</h2>
      <p><strong>Reason:</strong> ${reportData.reason}</p>
      <p><strong>Notes:</strong> ${reportData.notes || 'None'}</p>
      <h3>Phone Reference</h3>
      <p><strong>Caller ID (Twilio):</strong> ${callerId}</p>
    `;

    await transporter.sendMail({
      from: config.email.user,
      to: config.email.to,
      subject,
      html,
    });
    logger.info(`Report email sent for ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
