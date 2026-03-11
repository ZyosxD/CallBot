import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: parseInt(config.email.smtpPort, 10),
  secure: parseInt(config.email.smtpPort, 10) === 465, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendReportEmail = async (type, details) => {
  if (!config.email.notificationEmail) {
    logger.warn('Notification email is not configured. Skipping email send.');
    return;
  }

  const { contactName, companyName, confirmedPhone, callerId, appointmentTime, notes } = details;

  const isSuccess = type === 'SUCCESS';
  const subjectIcon = isSuccess ? '🟢' : '🟠';
  const subjectText = isSuccess ? 'SUCCESS: Appointment Scheduled' : 'REPORT: Interaction Logged';
  const subject = `${subjectIcon} ${subjectText} - ${companyName || 'Unknown Company'}`;

  const htmlContent = `
    <h2>1Wire Assistant Interaction Report</h2>
    <p><strong>Status:</strong> ${isSuccess ? 'Scheduled' : 'Interaction Ended'}</p>
    <hr>
    <h3>Client Details</h3>
    <ul>
      <li><strong>Contact Name:</strong> ${contactName || 'N/A'}</li>
      <li><strong>Company Name:</strong> ${companyName || 'N/A'}</li>
    </ul>
    <h3>Phone Verification</h3>
    <ul>
      <li><strong>Twilio Caller ID:</strong> ${callerId || 'Unknown'}</li>
      <li><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone || 'N/A'}</li>
    </ul>
    ${isSuccess ? `<h3>Appointment Details</h3><p><strong>Time:</strong> ${appointmentTime || 'N/A'}</p>` : ''}
    <h3>Notes</h3>
    <p>${notes || 'No notes provided.'}</p>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.smtpUser}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: htmlContent,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
