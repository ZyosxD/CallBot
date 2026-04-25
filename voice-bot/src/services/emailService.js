import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false,
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendEmail = async (type, data) => {
  if (!config.email.to) {
    logger.warn('No notification email configured. Skipping email send.');
    return;
  }

  let subject = '';
  let html = '';

  if (type === 'SUCCESS') {
    subject = `🟢 SUCCESS: New Technical Assessment Scheduled - ${data.companyName}`;
    html = `
      <h2>New Appointment Scheduled</h2>
      <p><strong>Contact Name:</strong> ${data.contactName}</p>
      <p><strong>Company Name:</strong> ${data.companyName}</p>
      <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
      <p><strong>Confirmed Phone:</strong> ${data.confirmedPhone}</p>
      <p><strong>Original Caller ID:</strong> ${data.callerId}</p>
      <p><em>Note: If Confirmed Phone differs from Caller ID, use the Confirmed Phone.</em></p>
      <p><strong>Call SID:</strong> ${data.callSid}</p>
    `;
  } else if (type === 'REPORT') {
    subject = `🟠 REPORT: Interaction Logged - ${data.callerId}`;
    html = `
      <h2>Interaction Report</h2>
      <p><strong>Reason:</strong> ${data.reason}</p>
      <p><strong>Details:</strong> ${data.details}</p>
      <p><strong>Caller ID:</strong> ${data.callerId}</p>
      <p><strong>Call SID:</strong> ${data.callSid}</p>
    `;
  }

  try {
    const info = await transporter.sendMail({
      from: `"Sarah Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: subject,
      html: html,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
