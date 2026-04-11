import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendReportEmail = async (subject, body) => {
  if (!config.email.to) {
    logger.warn('Email TO address is not configured. Skipping email send.');
    return;
  }

  try {
    await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: subject,
      text: body,
      html: body.replace(/\n/g, '<br>')
    });
    logger.info(`Email sent: ${subject}`);
  } catch (error) {
    logger.error('Failed to send email:', error);
  }
};
