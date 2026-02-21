import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port == 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendEmail = async (type, data) => {
  try {
    let subject = '';
    let html = '';

    if (type === 'success') {
      subject = '🟢 SUCCESS: Appointment Scheduled';
      html = `
        <h2>Appointment Details</h2>
        <p><strong>Name:</strong> ${data.name}</p>
        <p><strong>Company:</strong> ${data.company}</p>
        <p><strong>Phone (Confirmed):</strong> ${data.phone}</p>
        <p><strong>Caller ID (Twilio):</strong> ${data.callerId}</p>
        <p><strong>Time:</strong> ${data.time}</p>
        <p><strong>Notes:</strong> ${data.notes || 'N/A'}</p>
      `;
    } else if (type === 'report') {
      subject = '🟠 REPORT: Interaction Update';
      html = `
        <h2>Interaction Report</h2>
        <p><strong>Reason:</strong> ${data.reason}</p>
        <p><strong>Caller ID:</strong> ${data.callerId}</p>
        <p><strong>Transcript Summary:</strong> ${data.summary || 'N/A'}</p>
      `;
    }

    const info = await transporter.sendMail({
      from: `"Sarah Bot" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: html,
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
