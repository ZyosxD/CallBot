import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

export const sendEmail = async (subject, htmlBody) => {
  if (!config.email.notificationEmail) {
    logger.warn('Email notification disabled: NOTIFICATION_EMAIL not set.');
    return;
  }

  const transporter = nodemailer.createTransport(config.email.smtp);

  const mailOptions = {
    from: `"Sarah - 1Wire" <${config.email.smtp.auth.user}>`,
    to: config.email.notificationEmail,
    subject: subject,
    html: htmlBody
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
