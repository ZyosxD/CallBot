import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmail = async (to, subject, html) => {
  try {
    const info = await transporter.sendMail({
      from: `"1Wire Sarah" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const sendSuccessEmail = async (clientData, appointmentDetails) => {
  const subject = `🟢 New Lead: ${clientData.name}`;
  const html = `
    <h1>New Technical Assessment Scheduled!</h1>
    <p><strong>Client:</strong> ${clientData.name}</p>
    <p><strong>Phone (Confirmed):</strong> ${clientData.phone}</p>
    <p><strong>Company:</strong> ${clientData.company || 'N/A'}</p>
    <p><strong>Appointment Time:</strong> ${appointmentDetails.date} at ${appointmentDetails.time}</p>
    <p><strong>Needs:</strong> ${appointmentDetails.notes || 'General Assessment'}</p>
  `;
  await sendEmail(process.env.NOTIFICATION_EMAIL, subject, html);
};

export const sendReportEmail = async (clientData, interactionDetails) => {
  const subject = `🟠 Interaction Report: ${clientData.name || 'Unknown Caller'}`;
  const html = `
    <h1>Interaction Report</h1>
    <p><strong>Client:</strong> ${clientData.name || 'Unknown'}</p>
    <p><strong>Phone:</strong> ${clientData.phone}</p>
    <p><strong>Outcome:</strong> ${interactionDetails.outcome}</p>
    <p><strong>Notes:</strong> ${interactionDetails.notes || 'None'}</p>
  `;
  await sendEmail(process.env.NOTIFICATION_EMAIL, subject, html);
};
