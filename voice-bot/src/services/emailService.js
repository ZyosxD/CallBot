import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmailReport = async (type, data) => {
  try {
    const isSuccess = type === 'SUCCESS';
    const subjectEmoji = isSuccess ? '🟢' : '🟠';
    const subjectText = isSuccess ? 'SUCCESS: Technical Assessment Scheduled' : 'REPORT: Interaction Logged';

    const subject = `${subjectEmoji} ${subjectText} - 1Wire Assistant`;

    let htmlBody = `<h2>${subjectText}</h2>`;
    htmlBody += `<ul>`;

    // Always include Phone Comparison
    htmlBody += `<li><strong>Twilio Caller ID:</strong> ${data.callerId || 'N/A'}</li>`;

    if (isSuccess) {
      htmlBody += `<li><strong>Confirmed Phone (Verbal):</strong> ${data.confirmedPhone || 'N/A'}</li>`;
      htmlBody += `<li><strong>Contact Name:</strong> ${data.contactName || 'N/A'}</li>`;
      htmlBody += `<li><strong>Company Name:</strong> ${data.companyName || 'N/A'}</li>`;
      htmlBody += `<li><strong>Appointment Time:</strong> ${data.appointmentTime || 'N/A'}</li>`;
      htmlBody += `<li><strong>Notes:</strong> ${data.notes || 'N/A'}</li>`;
    } else {
      htmlBody += `<li><strong>Outcome:</strong> ${data.outcome || 'N/A'}</li>`;
      htmlBody += `<li><strong>Notes:</strong> ${data.notes || 'N/A'}</li>`;
    }

    htmlBody += `<li><strong>Call SID:</strong> ${data.callSid || 'N/A'}</li>`;
    htmlBody += `<li><strong>Mode:</strong> ${data.mode || 'N/A'}</li>`;
    htmlBody += `</ul>`;

    const mailOptions = {
      from: `"Sarah - 1Wire" <${process.env.SMTP_USER}>`,
      to: process.env.NOTIFICATION_EMAIL,
      subject: subject,
      html: htmlBody,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
