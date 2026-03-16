import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.smtp.host && config.smtp.user) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port == 465, // true for 465, false for other ports
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });
}

export const sendEmailReport = async (type, data, originalCallerId) => {
  if (!transporter || !config.notifications.email) {
    logger.warn('Email service is not configured. Skipping email report.');
    return;
  }

  const isSuccess = type === 'success';
  const subject = isSuccess ? '🟢 SUCCESS: New Technical Assessment Scheduled' : '🟠 REPORT: Interaction Logged';

  let htmlContent = `<h2>${isSuccess ? 'New Appointment Scheduled' : 'Call Interaction Report'}</h2>`;

  htmlContent += `
    <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
      <tr>
        <th style="background-color: #f2f2f2; text-align: left;">Field</th>
        <th style="background-color: #f2f2f2; text-align: left;">Details</th>
      </tr>
      <tr>
        <td><strong>Original Caller ID (Twilio)</strong></td>
        <td>${originalCallerId || 'Unknown'}</td>
      </tr>
  `;

  if (isSuccess) {
    htmlContent += `
      <tr>
        <td><strong>Contact Name</strong></td>
        <td>${data.contactName}</td>
      </tr>
      <tr>
        <td><strong>Company Name</strong></td>
        <td>${data.companyName}</td>
      </tr>
      <tr>
        <td><strong>Confirmed Phone (Verbal)</strong></td>
        <td>${data.confirmedPhone}</td>
      </tr>
      <tr>
        <td><strong>Appointment Time</strong></td>
        <td>${data.appointmentTime}</td>
      </tr>
    `;
  } else {
    htmlContent += `
      <tr>
        <td><strong>Outcome/Reason</strong></td>
        <td>${data.reason}</td>
      </tr>
    `;
  }

  htmlContent += `</table>`;

  const mailOptions = {
    from: `"1Wire Assistant" <${config.smtp.user}>`,
    to: config.notifications.email,
    subject: subject,
    html: htmlContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email report sent successfully: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
