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

export const sendReportEmail = async (type, details) => {
  try {
    const { contactName, companyName, originalPhone, confirmedPhone, appointmentTime, notes } = details;

    const isSuccess = type === 'SUCCESS';
    const subject = isSuccess
      ? `🟢 SUCCESS: New Appointment with ${companyName}`
      : `🟠 REPORT: Interaction with ${companyName || 'Unknown Company'}`;

    const htmlContent = `
      <h2>${isSuccess ? 'New Technical Assessment Scheduled' : 'Call Interaction Report'}</h2>
      <p><strong>Contact Name:</strong> ${contactName || 'N/A'}</p>
      <p><strong>Company Name:</strong> ${companyName || 'N/A'}</p>
      <hr />
      <h3>Phone Verification</h3>
      <p><strong>Original Caller ID:</strong> ${originalPhone || 'N/A'}</p>
      <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone || 'N/A'}</p>
      <p><em>${originalPhone === confirmedPhone ? '✅ Number matches' : '⚠️ Number difference detected'}</em></p>
      <hr />
      ${isSuccess ? `<p><strong>Appointment Time:</strong> ${appointmentTime}</p>` : ''}
      <p><strong>Notes:</strong></p>
      <p>${notes || 'No additional notes provided.'}</p>
    `;

    const info = await transporter.sendMail({
      from: `"Sarah (1Wire Assistant)" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: htmlContent,
    });

    logger.info(`Email sent successfully: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending email:', error);
    return false;
  }
};
