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

export const sendSuccessEmail = async (appointmentData, originalCallerId) => {
  const { contactName, companyName, confirmedPhone, appointmentTime, notes } = appointmentData;

  const htmlContent = `
    <h2>🟢 SUCCESS: New Technical Assessment Scheduled</h2>
    <p><strong>Company:</strong> ${companyName}</p>
    <p><strong>Contact:</strong> ${contactName}</p>
    <p><strong>Time:</strong> ${appointmentTime}</p>
    <br>
    <h3>Phone Number Verification</h3>
    <p><strong>Twilio Caller ID:</strong> ${originalCallerId}</p>
    <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>
    <p><em>${originalCallerId === confirmedPhone ? 'Numbers Match.' : 'Numbers DO NOT match. Please use confirmed phone.'}</em></p>
    <br>
    <h3>Notes</h3>
    <p>${notes || 'N/A'}</p>
  `;

  try {
    await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟢 SUCCESS: Assessment for ${companyName}`,
      html: htmlContent,
    });
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData, originalCallerId) => {
  const { reason, details } = interactionData;

  const htmlContent = `
    <h2>🟠 REPORT: Interaction Logged</h2>
    <p><strong>Reason:</strong> ${reason}</p>
    <p><strong>Phone Number:</strong> ${originalCallerId}</p>
    <br>
    <h3>Details</h3>
    <p>${details || 'No additional details provided.'}</p>
  `;

  try {
    await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟠 REPORT: ${reason} - ${originalCallerId}`,
      html: htmlContent,
    });
    logger.info(`Report email sent for ${originalCallerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
