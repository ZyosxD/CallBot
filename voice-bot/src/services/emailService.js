import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort == 465, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendSuccessEmail = async (leadData, callerId) => {
  const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${leadData.companyName}`;
  const text = `
    New Technical Assessment Scheduled!

    Company: ${leadData.companyName}
    Contact: ${leadData.contactName}
    Confirmed Phone: ${leadData.confirmedPhone}
    Twilio Caller ID: ${callerId}
    Match: ${leadData.confirmedPhone === callerId ? 'YES' : 'NO'}
    Appointment Time: ${leadData.appointmentTime}
    Needs: ${leadData.needs || 'N/A'}
  `;
  await sendEmail(subject, text);
};

export const sendReportEmail = async (interactionData, callerId) => {
  const subject = `🟠 REPORT: Call Interaction - ${interactionData.outcome}`;
  const text = `
    Call Interaction Report

    Outcome: ${interactionData.outcome}
    Reason: ${interactionData.reason || 'N/A'}
    Twilio Caller ID: ${callerId}
  `;
  await sendEmail(subject, text);
};

const sendEmail = async (subject, text) => {
  if (!config.email.notificationEmail) {
    logger.warn('Notification email not configured. Skipping email.');
    return;
  }

  try {
    await transporter.sendMail({
      from: `"Sarah AI" <${config.email.smtpUser}>`,
      to: config.email.notificationEmail,
      subject,
      text,
    });
    logger.info(`Email sent: ${subject}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
