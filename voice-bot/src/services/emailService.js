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

export const sendEmail = async (subject, html, to) => {
  try {
    const info = await transporter.sendMail({
      from: `"Sarah - 1Wire" <${config.email.user}>`, // sender address
      to: to || config.email.notificationEmail, // list of receivers
      subject: subject, // Subject line
      html: html, // html body
    });

    logger.info(`Message sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending email:', error);
    // Don't crash the bot if email fails, just log it
  }
};
