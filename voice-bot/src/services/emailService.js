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

export const sendSuccessEmail = async (leadData) => {
  try {
    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `🟢 New Lead: ${leadData.name} - ${leadData.company}`,
      html: `
        <h2>New Technical Assessment Scheduled!</h2>
        <p><strong>Name:</strong> ${leadData.name}</p>
        <p><strong>Company:</strong> ${leadData.company}</p>
        <p><strong>Phone (Confirmed):</strong> ${leadData.phone}</p>
        <p><strong>Phone (Twilio CallerID):</strong> ${leadData.twilioPhone || 'N/A'}</p>
        <p><strong>Date/Time:</strong> ${leadData.dateTime}</p>
        <p><strong>Notes:</strong> ${leadData.notes || 'N/A'}</p>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending success email:', error);
    // Don't throw, just log error so the bot doesn't crash
  }
};

export const sendReportEmail = async (interactionData) => {
  try {
    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `🟠 Interaction Report: ${interactionData.status} - ${interactionData.phone}`,
      html: `
        <h2>Interaction Report</h2>
        <p><strong>Status:</strong> ${interactionData.status}</p>
        <p><strong>Phone (Twilio):</strong> ${interactionData.twilioPhone}</p>
        <p><strong>Phone (Confirmed):</strong> ${interactionData.confirmedPhone || 'N/A'}</p>
        <p><strong>Summary:</strong> ${interactionData.summary}</p>
        <p><strong>Duration:</strong> ${interactionData.duration || 'N/A'} seconds</p>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending report email:', error);
    // Don't throw
  }
};
