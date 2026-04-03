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

export const sendReportEmail = async (type, data) => {
  if (!config.email.to || !config.email.user || !config.email.pass) {
    logger.warn('Email config missing, skipping email report.');
    return;
  }

  const isSuccess = type === 'SUCCESS';
  const emoji = isSuccess ? '🟢' : '🟠';
  const subjectStr = `${emoji} ${type} - ${data.companyName || 'Unknown Company'}`;

  const callerId = data.callerId || 'unknown';
  const confirmedPhone = data.confirmedPhone || 'unknown';

  let htmlContent = `
    <h2>${subjectStr}</h2>
    <p><strong>Caller ID (Twilio):</strong> ${callerId}</p>
    <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
    <hr />
  `;

  if (isSuccess) {
    htmlContent += `
      <p><strong>Contact Name:</strong> ${data.contactName}</p>
      <p><strong>Company:</strong> ${data.companyName}</p>
      <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
    `;
  } else {
    htmlContent += `
      <p><strong>Reason:</strong> Not interested / Voicemail / Call later</p>
      <p><strong>Notes:</strong> ${data.notes || 'N/A'}</p>
    `;
  }

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: subjectStr,
      html: htmlContent,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
