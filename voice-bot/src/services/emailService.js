import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  if (!config.email.host || !config.email.user || !config.email.pass) {
    logger.warn('Email credentials not configured. Emails will not be sent.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465, // true for 465, false for other ports
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });

  return transporter;
};

export const sendEmail = async (subject, text) => {
  try {
    const mailTransporter = getTransporter();

    if (!mailTransporter || !config.email.notificationEmail) {
      logger.info(`Mock Email Sent (Subject: ${subject}):\n${text}`);
      return;
    }

    const info = await mailTransporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: subject,
      text: text,
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
