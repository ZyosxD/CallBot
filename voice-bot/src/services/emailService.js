import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass
  }
});

export const sendEmailReport = async (type, data) => {
  if (!config.email.notificationEmail) {
    logger.warn('Notification email not configured. Skipping email report.');
    return;
  }

  let subject = '';
  let html = '';

  const twilioCallerId = data.twilioCallerId || 'N/A';
  const confirmedPhone = data.confirmedPhone || 'N/A';

  if (type === 'success') {
    subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName}`;
    html = `
      <h2>Technical Assessment Scheduled</h2>
      <p><strong>Contact Name:</strong> ${data.contactName}</p>
      <p><strong>Company Name:</strong> ${data.companyName}</p>
      <p><strong>Requested Time:</strong> ${data.appointmentTime}</p>
      <br />
      <h3>Phone Verification</h3>
      <ul>
        <li><strong>Original Caller ID:</strong> ${twilioCallerId}</li>
        <li><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</li>
      </ul>
      <p><strong>Match:</strong> ${twilioCallerId === confirmedPhone ? '✅ Yes' : '⚠️ No - Verify manually'}</p>
    `;
  } else if (type === 'report') {
    subject = `🟠 REPORT: Call Outcome - ${data.reason}`;
    html = `
      <h2>Call Interaction Report</h2>
      <p><strong>Outcome Reason:</strong> ${data.reason}</p>
      <p><strong>Notes:</strong> ${data.notes}</p>
      <br />
      <h3>Phone Details</h3>
      <ul>
        <li><strong>Original Caller ID:</strong> ${twilioCallerId}</li>
      </ul>
    `;
  }

  const mailOptions = {
    from: `"Sarah AI" <${config.smtp.user}>`,
    to: config.email.notificationEmail,
    subject,
    html
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Email report sent successfully: ${subject}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
