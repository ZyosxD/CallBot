import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port === 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (leadData) => {
  try {
    const { name, company, phone, appointmentTime, callerId } = leadData;
    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `🟢 New Lead: ${name} - ${company}`,
      text: `
        New Appointment Scheduled!

        Name: ${name}
        Company: ${company}
        Phone (Verbal): ${phone}
        Caller ID: ${callerId || 'N/A'}
        Appointment Time: ${appointmentTime}
      `,
      html: `
        <h2>🟢 New Lead!</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Company:</strong> ${company}</p>
        <p><strong>Phone (Verbal):</strong> ${phone}</p>
        <p><strong>Caller ID:</strong> ${callerId || 'N/A'}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${name}`);
    return true;
  } catch (error) {
    logger.error('Error sending success email:', error);
    return false;
  }
};

export const sendReportEmail = async (interactionData) => {
  try {
    const { phone, callerId, outcome, notes } = interactionData;
    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: `🟠 Interaction Report: ${phone}`,
      text: `
        Interaction Report

        Phone: ${phone}
        Caller ID: ${callerId || 'N/A'}
        Outcome: ${outcome}
        Notes: ${notes}
      `,
      html: `
        <h2>🟠 Interaction Report</h2>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Caller ID:</strong> ${callerId || 'N/A'}</p>
        <p><strong>Outcome:</strong> ${outcome}</p>
        <p><strong>Notes:</strong> ${notes}</p>
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for ${phone}`);
    return true;
  } catch (error) {
    logger.error('Error sending report email:', error);
    return false;
  }
};
