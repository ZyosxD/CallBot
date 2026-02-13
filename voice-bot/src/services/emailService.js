import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port == 465, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendEmail = async (type, data) => {
  try {
    let subject = '';
    let html = '';
    const {
      clientName,
      contactName,
      companyName,
      callerId,
      confirmedPhone,
      appointmentTime,
      notes,
      outcome
    } = data;

    const phoneComparison = `
      <h3>Phone Verification</h3>
      <p><strong>Twilio Caller ID:</strong> ${callerId || 'N/A'}</p>
      <p><strong>Confirmed Phone:</strong> ${confirmedPhone || 'N/A'}</p>
    `;

    if (type === 'SUCCESS') {
      subject = `🟢 New Lead: ${companyName || clientName}`;
      html = `
        <h2>New Appointment Scheduled!</h2>
        <p><strong>Contact Name:</strong> ${contactName}</p>
        <p><strong>Company Name:</strong> ${companyName}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
        ${phoneComparison}
        <p><strong>Notes:</strong> ${notes || 'No extra notes.'}</p>
      `;
    } else if (type === 'REPORT') {
      subject = `🟠 Interaction Report: ${clientName}`;
      html = `
        <h2>Call Interaction Report</h2>
        <p><strong>Client:</strong> ${clientName}</p>
        <p><strong>Outcome:</strong> ${outcome}</p>
        ${phoneComparison}
        <p><strong>Notes:</strong> ${notes || 'No extra notes.'}</p>
      `;
    }

    const info = await transporter.sendMail({
      from: config.smtp.user,
      to: config.smtp.notificationEmail,
      subject: subject,
      html: html,
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
