import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port == 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendSuccessEmail = async (appointmentData) => {
  try {
    const { name, company, phone, time, notes, callerId } = appointmentData;

    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `✅ NEW APPOINTMENT: ${company} - ${name}`,
      html: `
        <h2 style="color: green;">New Technical Assessment Scheduled!</h2>
        <p><strong>Company:</strong> ${company}</p>
        <p><strong>Contact:</strong> ${name}</p>
        <p><strong>Appointment Time:</strong> ${time}</p>
        <hr>
        <h3>Phone Verification</h3>
        <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
        <p><strong>Verified Phone:</strong> ${phone}</p>
        <hr>
        <h3>Notes & Needs</h3>
        <p>${notes || 'No specific notes provided.'}</p>
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

export const sendReportEmail = async (interactionData) => {
  try {
    const { result, notes, callerId, company } = interactionData;

    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `🔸 CALL REPORT: ${company || 'Unknown'} - ${result.toUpperCase()}`,
      html: `
        <h2 style="color: orange;">Call Interaction Report</h2>
        <p><strong>Outcome:</strong> ${result}</p>
        <p><strong>Company:</strong> ${company || 'Unknown'}</p>
        <p><strong>Caller ID:</strong> ${callerId}</p>
        <hr>
        <h3>Details</h3>
        <p>${notes || 'No details provided.'}</p>
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
