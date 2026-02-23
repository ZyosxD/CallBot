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

export const sendReport = async (subject, body) => {
  try {
    const info = await transporter.sendMail({
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: subject,
      html: body,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const sendSuccessEmail = async (clientName, contactName, phone, time, notes, originalCallerId) => {
  const subject = `🟢 Success: Appointment Scheduled with ${clientName}`;
  const body = `
    <h2>New Appointment Scheduled</h2>
    <p><strong>Company:</strong> ${clientName}</p>
    <p><strong>Contact:</strong> ${contactName}</p>
    <p><strong>Confirmed Phone:</strong> ${phone}</p>
    <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
    <p><strong>Time:</strong> ${time}</p>
    <p><strong>Notes:</strong> ${notes}</p>
  `;
  await sendReport(subject, body);
};

export const sendInteractionReport = async (outcome, notes, originalCallerId) => {
  const subject = `🟠 Report: Interaction Outcome - ${outcome}`;
  const body = `
    <h2>Interaction Report</h2>
    <p><strong>Outcome:</strong> ${outcome}</p>
    <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
    <p><strong>Notes:</strong> ${notes}</p>
  `;
  await sendReport(subject, body);
};
