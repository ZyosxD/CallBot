import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: parseInt(config.email.smtpPort, 10),
  secure: false, // Set to true if using port 465
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendReportEmail = async ({ type, callId, callerId, confirmedPhone, name, company, time, notes }) => {
  if (!config.email.notificationEmail) {
    logger.warn('Email notification skipped: NOTIFICATION_EMAIL not set.');
    return;
  }

  const isSuccess = type === 'success';
  const emoji = isSuccess ? '🟢' : '🟠';
  const statusText = isSuccess ? 'Success' : 'Report';

  const subject = `${emoji} ${statusText} - 1Wire AI Call - ${name || 'Unknown'}`;

  const textBody = `
New Interaction Report from Sarah (1Wire AI)

---
Call Details
---
Call ID: ${callId}
Caller ID (Twilio): ${callerId || 'Unknown'}
Confirmed Phone (Verbal): ${confirmedPhone || 'Not provided'}
Phone Match: ${callerId === confirmedPhone ? 'Yes ✅' : 'No ❌'}

---
Trifecta Information
---
Contact Name: ${name || 'N/A'}
Company Name: ${company || 'N/A'}
Appointment Time: ${time || 'N/A'}

---
Notes & Needs Detected
---
${notes || 'No additional notes.'}
  `;

  const mailOptions = {
    from: `"Sarah AI" <${config.email.smtpUser}>`,
    to: config.email.notificationEmail,
    subject: subject,
    text: textBody,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
