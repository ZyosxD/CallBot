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

export const sendEmail = async (subject, text, html) => {
  try {
    const info = await transporter.sendMail({
      from: `"Sarah 1Wire" <${config.email.user}>`,
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

export const sendSuccessEmail = async (data, callerId) => {
  const subject = `🟢 NEW APPOINTMENT: ${data.company}`;
  const html = `
    <h2>New Technical Assessment Scheduled</h2>
    <p><strong>Contact Name:</strong> ${data.name}</p>
    <p><strong>Company:</strong> ${data.company}</p>
    <p><strong>Confirmed Phone:</strong> ${data.phone}</p>
    <p><strong>Original CallerID:</strong> ${callerId}</p>
    <p><strong>Preferred Time:</strong> ${data.time}</p>
    <p><strong>Notes:</strong> ${data.notes || 'None'}</p>
  `;
  await sendEmail(subject, `New Appointment with ${data.company}`, html);
};

export const sendReportEmail = async (data, callerId) => {
  const subject = `🟠 INTERACTION REPORT: ${data.result}`;
  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Result:</strong> ${data.result}</p>
    <p><strong>CallerID:</strong> ${callerId}</p>
    <p><strong>Notes:</strong> ${data.notes || 'None'}</p>
  `;
  await sendEmail(subject, `Interaction Report: ${data.result}`, html);
};
