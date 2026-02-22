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

export const sendEmail = async (type, data) => {
  try {
    let subject = '';
    let text = '';
    let html = '';

    if (type === 'success') {
      subject = `🟢 NEW APPOINTMENT: ${data.company}`;
      text = `
        New Technical Assessment Scheduled!

        Contact: ${data.name}
        Company: ${data.company}
        Phone (Verified): ${data.phone}
        Caller ID: ${data.callerId || 'Unknown'}
        Time: ${data.time}
        Notes: ${data.notes || 'None'}
      `;
      html = `
        <h2>🟢 New Technical Assessment Scheduled!</h2>
        <p><strong>Contact:</strong> ${data.name}</p>
        <p><strong>Company:</strong> ${data.company}</p>
        <p><strong>Phone (Verified):</strong> ${data.phone}</p>
        <p><strong>Caller ID:</strong> ${data.callerId || 'Unknown'}</p>
        <p><strong>Time:</strong> ${data.time}</p>
        <p><strong>Notes:</strong> ${data.notes || 'None'}</p>
      `;
    } else if (type === 'report') {
      subject = `🟠 CALL REPORT: ${data.callerId}`;
      text = `
        Interaction Report

        Caller ID: ${data.callerId}
        Result: ${data.result}
        Notes: ${data.notes || 'None'}
      `;
      html = `
        <h2>🟠 Interaction Report</h2>
        <p><strong>Caller ID:</strong> ${data.callerId}</p>
        <p><strong>Result:</strong> ${data.result}</p>
        <p><strong>Notes:</strong> ${data.notes || 'None'}</p>
      `;
    }

    const info = await transporter.sendMail({
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: subject,
      text: text,
      html: html,
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
