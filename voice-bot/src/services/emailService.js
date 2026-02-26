import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendSuccessEmail = async (data) => {
  const { contactName, companyName, confirmedPhone, appointmentTime, callerId } = data;

  const phoneComparison = confirmedPhone && callerId && confirmedPhone !== callerId
    ? `<p>⚠️ <strong>Phone Mismatch:</strong> Called ID (${callerId}) vs Confirmed (${confirmedPhone})</p>`
    : `<p>📞 <strong>Phone:</strong> ${confirmedPhone || callerId}</p>`;

  const mailOptions = {
    from: `"Sarah Bot" <${config.smtp.user}>`,
    to: config.email.notificationEmail,
    subject: `🟢 New Appointment: ${companyName}`,
    html: `
      <h2>🚀 New Lead Captured!</h2>
      <p><strong>Contact Name:</strong> ${contactName}</p>
      <p><strong>Company:</strong> ${companyName}</p>
      ${phoneComparison}
      <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      <hr>
      <p><em>Scheduled by Sarah (AI Agent)</em></p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data) => {
  const { outcome, notes, callerId } = data;

  const mailOptions = {
    from: `"Sarah Bot" <${config.smtp.user}>`,
    to: config.email.notificationEmail,
    subject: `🟠 Interaction Report: ${outcome}`,
    html: `
      <h2>📝 Call Report</h2>
      <p><strong>Caller ID:</strong> ${callerId}</p>
      <p><strong>Outcome:</strong> ${outcome}</p>
      <p><strong>Notes:</strong> ${notes}</p>
      <hr>
      <p><em>Reported by Sarah (AI Agent)</em></p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
