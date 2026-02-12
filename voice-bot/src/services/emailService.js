import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.nodemailer.host,
  port: config.nodemailer.port,
  secure: config.nodemailer.port == 465, // true for 465, false for other ports
  auth: {
    user: config.nodemailer.user,
    pass: config.nodemailer.pass,
  },
});

export const sendSuccessEmail = async (leadData) => {
  const subject = `🟢 NEW LEAD: ${leadData.companyName || 'Unknown Company'}`;
  const html = `
    <h1 style="color: green;">New Technical Assessment Scheduled!</h1>
    <p><strong>Contact Name:</strong> ${leadData.name}</p>
    <p><strong>Company:</strong> ${leadData.companyName}</p>
    <p><strong>Confirmed Phone:</strong> ${leadData.phone}</p>
    <p><strong>Twilio Caller ID:</strong> ${leadData.callerId || 'N/A'}</p>
    <p><strong>Scheduled Time:</strong> ${leadData.appointmentTime}</p>
    <p><strong>Notes/Needs:</strong> ${leadData.notes || 'N/A'}</p>
  `;
  await sendEmail(subject, html);
};

export const sendReportEmail = async (interactionData) => {
  const subject = `🟠 INTERACTION REPORT: ${interactionData.clientName || 'Unknown'}`;
  const html = `
    <h1 style="color: orange;">Interaction Report</h1>
    <p><strong>Client:</strong> ${interactionData.clientName}</p>
    <p><strong>Phone:</strong> ${interactionData.phone}</p>
    <p><strong>Outcome:</strong> ${interactionData.outcome}</p>
    <p><strong>Notes:</strong> ${interactionData.notes || 'N/A'}</p>
  `;
  await sendEmail(subject, html);
};

const sendEmail = async (subject, html) => {
  if (!config.nodemailer.user || !config.nodemailer.pass) {
    logger.warn('SMTP credentials not provided. Email not sent.');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: config.nodemailer.email, // sender address
      to: config.nodemailer.email, // list of receivers (sending to self/admin)
      subject: subject,
      html: html,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
