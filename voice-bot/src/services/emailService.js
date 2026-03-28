import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // TLS
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendEmail = async (type, details) => {
  try {
    let subject = '';
    let html = '';

    const { originalCallerId, confirmedPhone, contactName, companyName, appointmentTime, notes } = details;

    if (type === 'SUCCESS') {
      subject = '🟢 SUCCESS: New Technical Assessment Scheduled';
      html = `
        <h2>New Technical Assessment Scheduled</h2>
        <p><strong>Contact Name:</strong> ${contactName}</p>
        <p><strong>Company Name:</strong> ${companyName}</p>
        <p><strong>Twilio Caller ID:</strong> ${originalCallerId}</p>
        <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      `;
    } else if (type === 'REPORT') {
      subject = '🟠 REPORT: Interaction Logged';
      html = `
        <h2>Interaction Report</h2>
        <p><strong>Twilio Caller ID:</strong> ${originalCallerId}</p>
        <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone || 'N/A'}</p>
        <p><strong>Notes/Outcome:</strong> ${notes}</p>
      `;
    }

    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject,
      html
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Email sent successfully: ${subject}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
