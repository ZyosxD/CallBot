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

export const sendAppointmentEmail = async (details) => {
  const { contactName, companyName, confirmedPhone, callerId, appointmentTime, needs } = details;

  const htmlContent = `
    <h2>Appointment Scheduled</h2>
    <p><strong>Contact Name:</strong> ${contactName}</p>
    <p><strong>Company Name:</strong> ${companyName}</p>
    <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
    <hr/>
    <h3>Phone Information</h3>
    <p><strong>Verbal Confirmed Phone:</strong> ${confirmedPhone}</p>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <p><em>Match Status: ${confirmedPhone === callerId ? 'Exact Match' : 'Mismatch'}</em></p>
    <hr/>
    <h3>Needs Detected</h3>
    <p>${needs}</p>
  `;

  try {
    await transporter.sendMail({
      from: `"Sarah (1Wire Assistant)" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟢 SUCCESS: New Appointment - ${companyName}`,
      html: htmlContent,
    });
    logger.info('Success email sent for appointment.');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const { callerId, reason, notes } = details;

  const htmlContent = `
    <h2>Interaction Report</h2>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <hr/>
    <h3>Notes</h3>
    <p>${notes}</p>
  `;

  try {
    await transporter.sendMail({
      from: `"Sarah (1Wire Assistant)" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction Log - ${callerId}`,
      html: htmlContent,
    });
    logger.info('Report email sent for interaction.');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
