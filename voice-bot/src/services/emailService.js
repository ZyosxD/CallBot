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

export const sendSuccessEmail = async (data) => {
  try {
    const { name, company, phone, confirmedPhone, appointmentTime, notes } = data;

    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `🟢 New Lead: ${name} (${company || 'Unknown Company'})`,
      html: `
        <h2>New Lead Generated!</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Company:</strong> ${company || 'N/A'}</p>
        <p><strong>Caller ID:</strong> ${phone}</p>
        <p><strong>Confirmed Phone:</strong> ${confirmedPhone || 'Not provided'}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
        <h3>Notes:</h3>
        <p>${notes || 'No notes provided.'}</p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending success email:', error);
    return false;
  }
};

export const sendReportEmail = async (data) => {
  try {
    const { name, phone, reason, transcript } = data;

    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `🟠 Interaction Report: ${name || 'Unknown'} - ${reason}`,
      html: `
        <h2>Interaction Report</h2>
        <p><strong>Name:</strong> ${name || 'Unknown'}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <h3>Transcript Summary:</h3>
        <p>${transcript || 'No transcript available.'}</p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending report email:', error);
    return false;
  }
};
