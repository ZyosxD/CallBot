import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendSuccessEmail = async (details) => {
  const subject = `🟢 New Lead: ${details.name} - ${details.company}`;
  const text = `
    New Lead Scheduled!

    Name: ${details.name}
    Company: ${details.company}
    Phone (Verbal): ${details.phone}
    Caller ID: ${details.callerId || 'N/A'}
    Requested Time: ${details.datetime}

    Notes/Pain Points:
    ${details.notes || 'None'}
  `;

  await sendEmail(subject, text);
};

export const sendReportEmail = async (details) => {
  const subject = `🟠 Interaction Report: ${details.outcome} - ${details.phone || 'Unknown'}`;
  const text = `
    Interaction Report

    Outcome: ${details.outcome}
    Phone (Caller ID): ${details.callerId || 'N/A'}

    Notes:
    ${details.notes || 'None'}
  `;

  await sendEmail(subject, text);
};

const sendEmail = async (subject, text) => {
  try {
    if (!config.notificationEmail) {
      logger.warn('Notification email not configured. Skipping email send.');
      return;
    }

    const info = await transporter.sendMail({
      from: `"1Wire AI Sarah" <${config.smtp.user}>`,
      to: config.notificationEmail,
      subject: subject,
      text: text,
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
