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

/**
 * Sends an email notification.
 * @param {string} subject - The subject of the email.
 * @param {string} text - The plain text body of the email.
 * @param {string} html - The HTML body of the email.
 */
export const sendEmail = async (subject, text, html) => {
  try {
    const info = await transporter.sendMail({
      from: config.email.user, // sender address
      to: config.email.notificationEmail, // list of receivers
      subject: subject, // Subject line
      text: text, // plain text body
      html: html, // html body
    });

    logger.info(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending email:', error);
    throw error;
  }
};

/**
 * Sends a success email (Green).
 * @param {object} details - The details of the appointment.
 */
export const sendSuccessEmail = async (details) => {
  const { name, company, verifiedPhone, callerId, date, time } = details;
  const subject = `🟢 SUCCESS: Appointment Scheduled - ${company}`;

  const html = `
    <h2>New Technical Assessment Scheduled</h2>
    <p><strong>Company:</strong> ${company}</p>
    <p><strong>Contact Name:</strong> ${name}</p>
    <p><strong>Date:</strong> ${date}</p>
    <p><strong>Time:</strong> ${time}</p>
    <hr>
    <h3>Phone Verification</h3>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <p><strong>Verbally Confirmed:</strong> ${verifiedPhone}</p>
    <p><em>(Please verify if they match or if the confirmed number is different)</em></p>
  `;

  const text = `New Technical Assessment Scheduled\n\nCompany: ${company}\nContact Name: ${name}\nDate: ${date}\nTime: ${time}\n\nPhone Verification:\nTwilio Caller ID: ${callerId}\nVerbally Confirmed: ${verifiedPhone}`;

  return sendEmail(subject, text, html);
};

/**
 * Sends a report email (Orange).
 * @param {object} report - The report details.
 */
export const sendReportEmail = async (report) => {
  const { status, callerId, notes } = report;
  const subject = `🟠 REPORT: Interaction Update - ${callerId}`;

  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Status:</strong> ${status}</p>
    <p><strong>Caller ID:</strong> ${callerId}</p>
    <p><strong>Notes:</strong> ${notes}</p>
  `;

  const text = `Interaction Report\n\nStatus: ${status}\nCaller ID: ${callerId}\nNotes: ${notes}`;

  return sendEmail(subject, text, html);
};
