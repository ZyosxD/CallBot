import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;
if (config.email && config.email.host && config.email.user) {
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });
}

export const sendReportEmail = async (subject, htmlContent) => {
  if (!transporter) {
    logger.warn('Email transporter not configured. Cannot send email.');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: config.email.from || '"1Wire Assistant" <noreply@1wire.co>',
      to: config.email.user, // Send reports back to self or defined address
      subject: subject,
      html: htmlContent,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const sendSuccessEmail = async (contactName, companyName, confirmedPhone, callerId, appointmentTime, needs) => {
  const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`;
  const html = `
    <h2>New Technical Assessment Scheduled</h2>
    <p><strong>Company Name:</strong> ${companyName}</p>
    <p><strong>Contact Name:</strong> ${contactName}</p>
    <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
    <p><strong>Needs/Notes:</strong> ${needs || 'None specified'}</p>
  `;
  await sendReportEmail(subject, html);
};

export const sendInteractionReportEmail = async (callerId, reason, notes) => {
  const subject = `🟠 REPORT: Interaction Logged - ${callerId}`;
  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <p><strong>Reason/Outcome:</strong> ${reason}</p>
    <p><strong>Notes:</strong> ${notes || 'None'}</p>
  `;
  await sendReportEmail(subject, html);
};
