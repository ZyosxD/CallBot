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

export const sendEmail = async (subject, text) => {
  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: subject,
      text: text,
    });
    logger.info(`Message sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const sendSuccessEmail = async (data) => {
  const subject = `🟢 SUCCESS: New Appointment Scheduled!`;
  const text = `
Hello!

A new appointment was scheduled successfully.

Details:
Contact Name: ${data.contactName}
Company Name: ${data.companyName}
Verbally Confirmed Phone: ${data.confirmedPhone}
Original Caller ID: ${data.callerId}
Appointment Time: ${data.appointmentTime}

Best regards,
Sarah (1Wire Assistant)
  `;
  await sendEmail(subject, text);
};

export const sendReportEmail = async (data) => {
  const subject = `🟠 REPORT: Call Interaction Log`;
  const text = `
Hello,

An interaction was logged during a call.

Details:
Caller ID: ${data.callerId}
Notes: ${data.notes || 'No notes provided'}
Result: ${data.result || 'Not interested / Voicemail'}

Best regards,
Sarah (1Wire Assistant)
  `;
  await sendEmail(subject, text);
};
