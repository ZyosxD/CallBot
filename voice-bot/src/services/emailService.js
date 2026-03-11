import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendReportEmail = async (type, callerId, confirmedPhone, details) => {
  if (!config.email.notificationEmail) {
    logger.warn('NOTIFICATION_EMAIL not configured. Skipping email report.');
    return;
  }

  const isSuccess = type === 'SUCCESS';
  const colorEmoji = isSuccess ? '🟢' : '🟠';
  const subject = `${colorEmoji} ${type} - Interaction Report`;

  const htmlContent = `
    <h2>Interaction Report</h2>
    <p><strong>Status:</strong> ${type}</p>
    <hr />
    <h3>Phone Verification</h3>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>
    <p><em>Match:</em> ${callerId === confirmedPhone ? '✅ Yes' : '❌ No'}</p>
    <hr />
    <h3>Details</h3>
    <pre>${JSON.stringify(details, null, 2)}</pre>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Sarah AI" <${config.email.smtpUser}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: htmlContent,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error(`Error sending email: ${error.message}`);
  }
};
