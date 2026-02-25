import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

export const sendReportEmail = async (clientData, interactionData, isSuccess) => {
  try {
    const transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === '465', // true for 465, false for other ports
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });

    const subjectColor = isSuccess ? '🟢 Success' : '🟠 Report';
    const subject = `${subjectColor}: Interaction with ${clientData.name}`;

    const htmlContent = `
      <h2>Call Report: ${clientData.name}</h2>
      <p><strong>Status:</strong> ${isSuccess ? 'Success' : 'Report'}</p>
      <p><strong>Twilio Caller ID:</strong> ${clientData.phone}</p>
      <p><strong>Confirmed Phone:</strong> ${interactionData.confirmedPhone || 'N/A'}</p>
      <hr>
      <h3>Details:</h3>
      <p><strong>Contact Name:</strong> ${interactionData.contactName || 'N/A'}</p>
      <p><strong>Company Name:</strong> ${interactionData.companyName || clientData.name}</p>
      <p><strong>Notes:</strong> ${interactionData.notes || 'N/A'}</p>
      <p><strong>Appointment Time:</strong> ${interactionData.appointmentTime || 'N/A'}</p>
    `;

    const info = await transporter.sendMail({
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: subject,
      html: htmlContent,
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
