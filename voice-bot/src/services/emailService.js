import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: {
    user: config.email.auth.user,
    pass: config.email.auth.pass
  }
});

export const sendEmailReport = async (subject, body) => {
  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: subject,
      html: body
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};

export const formatSuccessEmail = (data, callerId) => {
  const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName}`;
  const body = `
    <h2>Technical Assessment Scheduled</h2>
    <p><strong>Company Name:</strong> ${data.companyName}</p>
    <p><strong>Contact Name:</strong> ${data.contactName}</p>
    <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
    <hr>
    <h3>Phone Verification</h3>
    <p><strong>Confirmed Phone:</strong> ${data.confirmedPhone}</p>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <p><em>Note: If numbers differ, the confirmed phone is preferred.</em></p>
  `;
  return { subject, body };
};

export const formatReportEmail = (details, callerId) => {
  const subject = `🟠 REPORT: Interaction Details - Caller ${callerId}`;
  const body = `
    <h2>Interaction Report</h2>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <hr>
    <p><strong>Details:</strong></p>
    <pre>${details}</pre>
  `;
  return { subject, body };
};
