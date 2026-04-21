import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport(config.email);

export const sendEmail = async (type, data) => {
  if (!config.email.to) {
    logger.warn('Email notification skipped: No recipient configured.');
    return;
  }

  let subject = '';
  let text = '';

  const { twilioCallerId, confirmedPhone, callSid } = data;
  const phoneMatchInfo = `Twilio Caller ID: ${twilioCallerId}\nVerbally Confirmed Phone: ${confirmedPhone || 'N/A'}`;

  if (type === 'SUCCESS') {
    subject = '🟢 SUCCESS: New Appointment Scheduled';
    text = `A new appointment was scheduled successfully.\n\n` +
           `Contact Name: ${data.contactName}\n` +
           `Company Name: ${data.companyName}\n` +
           `Appointment Time: ${data.appointmentTime}\n\n` +
           `${phoneMatchInfo}\n\n` +
           `Call SID: ${callSid}\n` +
           `Timestamp: ${data.timestamp}`;
  } else if (type === 'REPORT') {
    subject = '🟠 REPORT: Interaction Logged';
    text = `An interaction was logged but no appointment was scheduled.\n\n` +
           `Reason: ${data.reason}\n` +
           `Details: ${data.details || 'None'}\n\n` +
           `${phoneMatchInfo}\n\n` +
           `Call SID: ${callSid}\n` +
           `Timestamp: ${data.timestamp}`;
  } else {
    logger.error(`Unknown email type: ${type}`);
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.auth.user}>`,
      to: config.email.to,
      subject,
      text
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
