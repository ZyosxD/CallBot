import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

try {
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port == 465, // true for 465, false for other ports
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });
} catch (err) {
  logger.error('Failed to initialize nodemailer transporter:', err);
}

export const sendEmailReport = async ({ type, callSid, callerId, data }) => {
  if (!transporter) {
    logger.warn('Email transporter not initialized. Cannot send email report.');
    return;
  }

  const isSuccess = type === 'SUCCESS';
  const icon = isSuccess ? '🟢' : '🟠';
  const subjectText = isSuccess ? 'SUCCESS: Appointment Scheduled' : 'REPORT: Call Interaction';

  const subject = `${icon} ${subjectText}`;

  // Format the comparison of numbers for the email
  const originalNumber = callerId || 'Unknown';
  const confirmedNumber = data.confirmedPhone || 'N/A';

  const phoneComparison = `
Original Twilio Caller ID: ${originalNumber}
Verbally Confirmed Phone:  ${confirmedNumber}
  `;

  let details = '';
  if (isSuccess) {
    details = `
Contact Name:    ${data.contactName}
Company Name:    ${data.companyName}
Appointment:     ${data.appointmentTime}
    `;
  } else {
    details = `
Reason:          ${data.reason}
Notes:           ${data.notes}
    `;
  }

  const text = `
Call SID:        ${callSid}

--- PHONE NUMBERS ---${phoneComparison}
--- DETAILS ---${details}
  `;

  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: subject,
      text: text,
    });
    logger.info(`Email report sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
