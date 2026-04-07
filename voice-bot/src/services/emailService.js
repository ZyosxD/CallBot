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

export const sendReportEmail = async (type, details) => {
  try {
    let subject = '';
    let text = '';

    if (type === 'SUCCESS') {
      subject = `🟢 SUCCESS: New Appointment with ${details.companyName}`;
      text = `
A new Technical Assessment appointment has been scheduled!

Company: ${details.companyName}
Contact: ${details.contactName}
Confirmed Phone: ${details.confirmedPhone}
Original Caller ID: ${details.callerId}
Phone Match: ${details.confirmedPhone === details.callerId ? 'YES' : 'NO - DIFFERENT NUMBER'}
Appointment Time: ${details.appointmentTime}
      `.trim();
    } else if (type === 'REPORT') {
      subject = `🟠 REPORT: Interaction with ${details.callerId}`;
      text = `
An interaction has been logged.

Original Caller ID: ${details.callerId}
Outcome: ${details.outcome}
Details: ${details.notes || 'No notes provided.'}
      `.trim();
    } else {
      return;
    }

    if (!config.email.to) {
        logger.warn('No REPORT_EMAIL_TO configured. Email not sent.');
        return;
    }

    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: subject,
      text: text,
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
