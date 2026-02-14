import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendSuccessEmail = async (data) => {
  try {
    const { clientName, businessName, verifiedPhone, appointmentTime, notes } = data;
    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `🟢 New Lead: ${businessName} - ${clientName}`,
      html: `
        <h2>🟢 New Lead Successfully Scheduled!</h2>
        <p><strong>Business Name:</strong> ${businessName}</p>
        <p><strong>Client Name:</strong> ${clientName}</p>
        <p><strong>Verified Phone:</strong> ${verifiedPhone}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
        <p><strong>Notes:</strong> ${notes || 'No notes'}</p>
        <hr>
        <p><em>Please follow up immediately.</em></p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending success email:', error);
    // Don't throw, just log
  }
};

export const sendReportEmail = async (data) => {
  try {
    const { outcome, notes, phone, callerId } = data;
    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `🟠 Interaction Report: ${outcome} - ${phone}`,
      html: `
        <h2>🟠 Call Interaction Report</h2>
        <p><strong>Outcome:</strong> ${outcome}</p>
        <p><strong>Phone (Client):</strong> ${phone}</p>
        <p><strong>Caller ID (Twilio):</strong> ${callerId || 'N/A'}</p>
        <p><strong>Notes:</strong> ${notes || 'No notes'}</p>
        <hr>
        <p><em>This lead may need follow-up later.</em></p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
